// providers/ThymeleafDiagnosticProvider.ts

import { vscode } from "@exportLibs";
import { analyzeSemantics, analyzeTemplate, buildScopes } from "@exportModels";
import { logger } from "@exportScripts";
import type { DiagnosticSeverityType, ExpressionIssueType, JavaIndexServiceType, SemanticIndexType, TemplateAttributeType, TemplateIndexServiceType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const DIAGNOSTIC_SOURCE = `Thymeleaf`;
const FRAGMENT_REF_NAMES: ReadonlySet<string> = new Set([`insert`, `replace`, `include`, `substituteby`, `decorate`, `decorator`]);
const SEVERITY_MAP: Readonly<Record<DiagnosticSeverityType, vscode.DiagnosticSeverity>> = {
  "error": vscode.DiagnosticSeverity.Error,
  "warning": vscode.DiagnosticSeverity.Warning,
  "information": vscode.DiagnosticSeverity.Information,
  "hint": vscode.DiagnosticSeverity.Hint,
};

// ------------------------------------------------------------------------------
// 1. Thymeleaf 템플릿 진단 (구문 + 시맨틱)
// ------------------------------------------------------------------------------
export const ThymeleafDiagnosticProvider = (templateIndex: TemplateIndexServiceType, javaIndex: JavaIndexServiceType, semanticIndex: SemanticIndexType) => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);

  // 1-1. 설정 조회
  const getConfig = () => {
    const config = vscode.workspace.getConfiguration(MAIN);
    return {
      "enabled": config.get<boolean>(`diagnosticsEnabled`, true),
      "disabledCodes": new Set(config.get<string[]>(`disabledDiagnosticCodes`, [])),
      "additionalAttributes": config.get<string[]>(`additionalAttributes`, []),
      "maxDocumentLength": config.get<number>(`maxDocumentLength`, 300_000),
      "modelValidation": config.get<boolean>(`modelValidationEnabled`, true),
      "linkValidation": config.get<boolean>(`linkValidationEnabled`, true),
      "messageValidation": config.get<boolean>(`messageValidationEnabled`, true),
    };
  };

  // 1-2. 진단 대상 문서 여부
  const isTarget = (document: vscode.TextDocument): boolean => document.languageId === `html` && document.uri.scheme !== `git`;

  // 1-3. 모델 진단 -> VS Code 진단 변환
  const toDiagnostic = (document: vscode.TextDocument, entry: ExpressionIssueType): vscode.Diagnostic => {
    const start = document.positionAt(entry.offset);
    const end = document.positionAt(entry.offset + entry.length);
    const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end), entry.message, SEVERITY_MAP[entry.severity]);
    diagnostic.source = DIAGNOSTIC_SOURCE;
    diagnostic.code = entry.code;
    if (entry.code === `thymeleaf-deprecated-attribute`) {
      diagnostic.tags = [vscode.DiagnosticTag.Deprecated];
    }
    return diagnostic;
  };

  // 1-4. 프래그먼트 참조 템플릿 존재 검사
  const buildTemplateDiagnostics = async (document: vscode.TextDocument, attributes: TemplateAttributeType[]): Promise<vscode.Diagnostic[]> => {
    const diagnostics: vscode.Diagnostic[] = [];
    const checked = new Set<string>();
    for (const attribute of attributes.filter((candidate) => FRAGMENT_REF_NAMES.has(candidate.name) && candidate.hasValue)) {
      for (const node of attribute.parsed.expressions) {
        if (node.kind !== `fragment` || !node.template || node.template.dynamic || node.template.value === `` || node.template.value === `this`) {
          continue;
        }
        const key = `${node.template.value}@${node.template.offset}`;
        if (checked.has(key)) {
          continue;
        }
        checked.add(key);
        const resolved = await templateIndex.resolveTemplate(node.template.value, document.uri);
        resolved || diagnostics.push(toDiagnostic(document, { "code": `thymeleaf-unknown-template`, "message": `Template '${node.template.value}' was not found under the configured template roots.`, "severity": `warning`, "offset": node.template.offset, "length": node.template.length }));
      }
    }
    return diagnostics;
  };

  // 2-1. 문서 진단 적용
  const apply = async (document: vscode.TextDocument): Promise<void> => {
    if (!isTarget(document)) {
      return;
    }
    const config = getConfig();
    const text = document.getText();
    if (!config.enabled || (config.maxDocumentLength > 0 && text.length > config.maxDocumentLength)) {
      collection.delete(document.uri);
      return;
    }
    const version = document.version;
    const analysis = analyzeTemplate(text, { "additionalAttributes": config.additionalAttributes });
    if (!analysis.template.isThymeleaf) {
      collection.delete(document.uri);
      return;
    }
    const diagnostics = analysis.diagnostics.map((entry) => toDiagnostic(document, entry));

    // 시맨틱 진단 (Java 인덱스 준비 후 모델 검증)
    const templateName = templateIndex.templateNameOf(document.uri);
    const scopes = buildScopes(analysis.template);
    const semantic = analyzeSemantics(analysis.template, scopes, semanticIndex, {
      "templateName": templateName,
      "modelValidation": config.modelValidation && javaIndex.isReady(),
      "linkValidation": config.linkValidation,
      "messageValidation": config.messageValidation,
    });
    diagnostics.push(...semantic.diagnostics.map((entry) => toDiagnostic(document, entry)));

    try {
      diagnostics.push(...await buildTemplateDiagnostics(document, analysis.template.attributes));
    }
    catch (error) {
      logger(`error`, `apply - template resolution failed: ${error}`);
    }
    if (document.isClosed || document.version !== version) {
      return;
    }
    const filtered = config.disabledCodes.size === 0 ? diagnostics : diagnostics.filter((item) => !config.disabledCodes.has(String(item.code)));
    collection.set(document.uri, filtered);
    logger(`debug`, `apply - ${document.uri.fsPath}: ${filtered.length} diagnostics`);
  };

  // 2-2. 열린 문서 전체 진단
  const applyOpenDocuments = async (): Promise<void> => {
    await Promise.all(vscode.workspace.textDocuments.filter(isTarget).map((document) => apply(document)));
  };

  // 2-3. 진단 제거·해제
  const clear = (document: vscode.TextDocument): void => {
    collection.delete(document.uri);
  };
  const dispose = (): void => {
    collection.dispose();
  };

  return { apply, applyOpenDocuments, clear, dispose };
};
