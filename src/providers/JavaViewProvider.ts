// providers/JavaViewProvider.ts

import { vscode } from "@exportLibs";
import { isModelSource, parseJavaFile } from "@exportModels";
import { logger } from "@exportScripts";
import type { JavaFileType, JavaTypeType, JavaViewNameType, ModelAttributeType, TemplateIndexServiceType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const DIAGNOSTIC_SOURCE = `Thymeleaf`;
const VIEW_STRING_PATTERN = /(?:\breturn\s+|ModelAndView\s*\(\s*|setViewName\s*\(\s*)"([\w/.-]*)$/;

interface CachedFileType {
  version: number;
  file: JavaFileType;
}

// ------------------------------------------------------------------------------
// 1. Java 컨트롤러 측 기능 (뷰명 진단·CodeLens·정의·참조·완성)
// ------------------------------------------------------------------------------
export const JavaViewProvider = (templateIndex: TemplateIndexServiceType) => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const collection = vscode.languages.createDiagnosticCollection(`${DIAGNOSTIC_SOURCE}-java`);
  const cache = new Map<string, CachedFileType>();
  const lensEmitter = new vscode.EventEmitter<void>();

  // 1-1. 설정·대상
  const isEnabled = (): boolean => vscode.workspace.getConfiguration(MAIN).get<boolean>(`javaEnabled`, true);
  const isLensEnabled = (): boolean => vscode.workspace.getConfiguration(MAIN).get<boolean>(`codeLensEnabled`, true);
  const isTarget = (document: vscode.TextDocument): boolean => document.languageId === `java` && document.uri.scheme !== `git`;

  // 1-2. 문서 파싱 캐시
  const parseDocument = (document: vscode.TextDocument): JavaFileType => {
    const key = document.uri.toString();
    const cached = cache.get(key);
    if (cached && cached.version === document.version) {
      return cached.file;
    }
    const file = parseJavaFile(document.getText(), document.uri.fsPath);
    cache.set(key, { "version": document.version, "file": file });
    return file;
  };
  const controllersOf = (file: JavaFileType): JavaTypeType[] => file.types.filter(isModelSource);

  // 1-3. 뷰 리터럴·속성 리터럴 탐색
  const viewAt = (file: JavaFileType, offset: number): JavaViewNameType | undefined => controllersOf(file).flatMap((type) => type.handlers.flatMap((handler) => handler.viewNames)).find((view) => !view.implicit && offset >= view.offset && offset <= view.offset + view.length);
  const attributeAt = (file: JavaFileType, offset: number): ModelAttributeType | undefined => controllersOf(file).flatMap((type) => [...type.classAttributes, ...type.modelAttributeMethods, ...type.flashAttributes]).find((attribute) => attribute.source !== `param` && attribute.source !== `modelAttributeMethod` && offset >= attribute.offset && offset <= attribute.offset + attribute.length);

  // 1-4. 사용처 위치 (문서 열어 오프셋 변환)
  const resolveUsageLocations = async (name: string): Promise<vscode.Location[]> => {
    const usages = templateIndex.attributeUsages(name);
    const documents = new Map<string, vscode.TextDocument>();
    const locations: vscode.Location[] = [];
    for (const usage of usages) {
      const key = usage.uri.toString();
      const document = documents.get(key) ?? await vscode.workspace.openTextDocument(usage.uri);
      documents.set(key, document);
      locations.push(new vscode.Location(usage.uri, new vscode.Range(document.positionAt(usage.offset), document.positionAt(usage.offset + usage.length))));
    }
    return locations;
  };

  // 2-1. 뷰 템플릿 존재 진단
  const apply = async (document: vscode.TextDocument): Promise<void> => {
    if (!isTarget(document) || !isEnabled()) {
      return;
    }
    const version = document.version;
    const file = parseDocument(document);
    const diagnostics: vscode.Diagnostic[] = [];
    for (const type of controllersOf(file)) {
      for (const handler of type.handlers) {
        for (const view of handler.viewNames) {
          if (view.implicit) {
            continue;
          }
          const resolved = templateIndex.templateUri(view.name) ?? await templateIndex.resolveTemplate(view.name, document.uri);
          if (resolved) {
            continue;
          }
          const range = new vscode.Range(document.positionAt(view.offset), document.positionAt(view.offset + view.length));
          const diagnostic = new vscode.Diagnostic(range, `Thymeleaf template '${view.name}' was not found under the configured template roots.`, vscode.DiagnosticSeverity.Warning);
          diagnostic.source = DIAGNOSTIC_SOURCE;
          diagnostic.code = `thymeleaf-missing-view`;
          diagnostics.push(diagnostic);
        }
      }
    }
    if (document.isClosed || document.version !== version) {
      return;
    }
    collection.set(document.uri, diagnostics);
    lensEmitter.fire();
  };
  const applyOpenDocuments = async (): Promise<void> => {
    await Promise.all(vscode.workspace.textDocuments.filter(isTarget).map((document) => apply(document)));
  };
  const clear = (document: vscode.TextDocument): void => {
    collection.delete(document.uri);
    cache.delete(document.uri.toString());
  };

  // 2-2. CodeLens (뷰 열기·속성 사용처)
  const codeLensProvider: vscode.CodeLensProvider = {
    "onDidChangeCodeLenses": lensEmitter.event,
    provideCodeLenses: (document) => {
      if (!isEnabled() || !isLensEnabled()) {
        return [];
      }
      const file = parseDocument(document);
      const lenses: vscode.CodeLens[] = [];
      for (const type of controllersOf(file)) {
        for (const handler of type.handlers) {
          for (const view of handler.viewNames) {
            const target = templateIndex.templateUri(view.name);
            const range = new vscode.Range(document.positionAt(view.offset), document.positionAt(view.offset + view.length));
            lenses.push(new vscode.CodeLens(range, target
              ? { "title": `$(go-to-file) Thymeleaf: open ${view.name}`, "command": `${MAIN}.openTemplate`, "arguments": [target.fsPath] }
              : { "title": `$(warning) Thymeleaf: template ${view.name} not found`, "command": `${MAIN}.openLogOutput` }));
          }
        }
        const seen = new Set<string>();
        for (const attribute of type.classAttributes) {
          if (seen.has(attribute.name) || attribute.source === `view`) {
            continue;
          }
          seen.add(attribute.name);
          const usages = templateIndex.attributeUsages(attribute.name);
          const range = new vscode.Range(document.positionAt(attribute.offset), document.positionAt(attribute.offset + attribute.length));
          lenses.push(new vscode.CodeLens(range, { "title": `${usages.length} template usage${usages.length === 1 ? `` : `s`}`, "command": `${MAIN}.showAttributeUsages`, "arguments": [document.uri, range.start, attribute.name] }));
        }
      }
      return lenses;
    },
  };

  // 2-3. 정의 (뷰 리터럴 -> 템플릿, 속성 리터럴 -> 사용처)
  const definitionProvider: vscode.DefinitionProvider = {
    provideDefinition: async (document, position) => {
      if (!isEnabled()) {
        return undefined;
      }
      const file = parseDocument(document);
      const offset = document.offsetAt(position);
      const view = viewAt(file, offset);
      if (view) {
        const target = templateIndex.templateUri(view.name) ?? await templateIndex.resolveTemplate(view.name, document.uri);
        return target ? new vscode.Location(target, new vscode.Position(0, 0)) : undefined;
      }
      const attribute = attributeAt(file, offset);
      return attribute ? resolveUsageLocations(attribute.name) : undefined;
    },
  };

  // 2-4. 참조 (속성 리터럴 -> 템플릿 사용처)
  const referenceProvider: vscode.ReferenceProvider = {
    provideReferences: async (document, position) => {
      if (!isEnabled()) {
        return undefined;
      }
      const attribute = attributeAt(parseDocument(document), document.offsetAt(position));
      return attribute ? resolveUsageLocations(attribute.name) : undefined;
    },
  };

  // 2-5. 뷰명 완성 (return "..." / new ModelAndView("...") / setViewName("..."))
  const completionProvider: vscode.CompletionItemProvider = {
    provideCompletionItems: (document, position) => {
      if (!isEnabled()) {
        return undefined;
      }
      const lineBefore = document.lineAt(position.line).text.slice(0, position.character);
      const match = VIEW_STRING_PATTERN.exec(lineBefore);
      if (!match) {
        return undefined;
      }
      const range = new vscode.Range(position.translate(0, -match[1].length), position);
      return templateIndex.listTemplateNames().map((name) => {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.File);
        item.detail = `Thymeleaf template`;
        item.range = range;
        return item;
      });
    },
  };

  // 2-6. 사용처 표시 명령
  const showAttributeUsages = async (uri: vscode.Uri, position: vscode.Position, name: string): Promise<void> => {
    const locations = await resolveUsageLocations(name);
    logger(`debug`, `showAttributeUsages - ${name}: ${locations.length}`);
    await vscode.commands.executeCommand(`editor.action.showReferences`, uri, position, locations);
  };

  const refreshLenses = (): void => lensEmitter.fire();
  const dispose = (): void => {
    collection.dispose();
    cache.clear();
    lensEmitter.dispose();
  };

  return { apply, applyOpenDocuments, clear, codeLensProvider, definitionProvider, referenceProvider, completionProvider, showAttributeUsages, refreshLenses, dispose };
};
