// providers/ThymeleafDiagnosticProvider.ts

import { vscode } from "@exportLibs";
import { analyzeTemplate, parseFragmentReference } from "@exportModels";
import { logger } from "@exportScripts";
import type { DiagnosticSeverityType, TemplateAttributeType, TemplateDiagnosticType, TemplateIndexServiceType } from "@exportTypes";

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
// 1. Thymeleaf 템플릿 진단
// ------------------------------------------------------------------------------
export const ThymeleafDiagnosticProvider = (indexService: TemplateIndexServiceType) => {
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
    };
  };

  // 1-2. 진단 대상 문서 여부
  const isTarget = (document: vscode.TextDocument): boolean => document.languageId === `html` && document.uri.scheme !== `git`;

  // 1-3. 모델 진단 -> VS Code 진단 변환
  const toDiagnostic = (entry: TemplateDiagnosticType): vscode.Diagnostic => {
    const range = new vscode.Range(entry.line, entry.column, entry.line, entry.column + entry.length);
    const diagnostic = new vscode.Diagnostic(range, entry.message, SEVERITY_MAP[entry.severity]);
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
    const refs = attributes.filter((attribute) => FRAGMENT_REF_NAMES.has(attribute.name) && attribute.hasValue);
    for (const attribute of refs) {
      const reference = parseFragmentReference(attribute.value);
      if (!reference || reference.dynamic || reference.template === ``) {
        continue;
      }
      const resolved = await indexService.resolveTemplate(reference.template, document.uri);
      if (resolved) {
        continue;
      }
      const start = document.positionAt(attribute.valueOffset);
      const end = document.positionAt(attribute.valueOffset + attribute.value.length);
      const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end), `Template '${reference.template}' was not found under the configured template roots.`, vscode.DiagnosticSeverity.Warning);
      diagnostic.source = DIAGNOSTIC_SOURCE;
      diagnostic.code = `thymeleaf-unknown-template`;
      diagnostics.push(diagnostic);
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
    const diagnostics = analysis.diagnostics.map(toDiagnostic);
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
