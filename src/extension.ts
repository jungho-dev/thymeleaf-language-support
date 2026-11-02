// extension.ts

import { ThymeleafCommand } from "@exportCommands";
import { vscode } from "@exportLibs";
import { JavaViewProvider, ThymeleafDiagnosticProvider, ThymeleafLanguageProvider } from "@exportProviders";
import { disposeLogger, initLogger, logger } from "@exportScripts";
import { DocumentModelService, JavaIndexService, MessageIndexService, SemanticIndexService, TemplateIndexService } from "@exportServices";
import type { DocumentModelServiceType, JavaIndexServiceType, JavaViewProviderType, MessageIndexServiceType, TemplateIndexServiceType, ThymeleafDiagnosticProviderType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const CHANGE_DEBOUNCE_MS = 300;
const INDEX_REFRESH_DEBOUNCE_MS = 500;
const HTML_SELECTOR: vscode.DocumentSelector = { "language": `html` };
const JAVA_SELECTOR: vscode.DocumentSelector = { "language": `java` };

// 1-1. deactivate
export const deactivate = () => {
  disposeLogger();
};

// 1-2. activate
export const activate = (context: vscode.ExtensionContext) => {
  initLogger();
  logger(`info`, `Thymeleaf-Language-Support is now active!`);

  // Java·메시지 인덱스는 템플릿이 있을 때만 구성 (Thymeleaf 없는 Java 프로젝트의 자원 낭비 방지)
  const templateIndex = TemplateIndexService();
  const hasTemplates = (): boolean => templateIndex.templateCount() > 0;
  const javaIndex = JavaIndexService(hasTemplates);
  const messageIndex = MessageIndexService(hasTemplates);
  const documentModels = DocumentModelService();
  const semanticIndex = SemanticIndexService(javaIndex, messageIndex, templateIndex);
  const diagnosticProvider = ThymeleafDiagnosticProvider(templateIndex, javaIndex, semanticIndex, documentModels);
  const languageProvider = ThymeleafLanguageProvider(templateIndex, javaIndex, messageIndex, semanticIndex, documentModels);
  const javaViewProvider = JavaViewProvider(templateIndex);
  const commandManager = ThymeleafCommand({ templateIndex, javaIndex, messageIndex, diagnosticProvider, languageProvider, javaViewProvider });

  const commands = commandManager.registerCommands();
  const providers = [
    vscode.languages.registerCompletionItemProvider(HTML_SELECTOR, languageProvider.completionProvider, `:`, `-`, `#`, `{`, `.`, `/`),
    vscode.languages.registerHoverProvider(HTML_SELECTOR, languageProvider.hoverProvider),
    vscode.languages.registerDocumentSymbolProvider(HTML_SELECTOR, languageProvider.symbolProvider),
    vscode.languages.registerDefinitionProvider(HTML_SELECTOR, languageProvider.definitionProvider),
    vscode.languages.registerReferenceProvider(HTML_SELECTOR, languageProvider.referenceProvider),
    vscode.languages.registerSignatureHelpProvider(HTML_SELECTOR, languageProvider.signatureHelpProvider, `(`, `,`),
    vscode.languages.registerDocumentLinkProvider(HTML_SELECTOR, languageProvider.documentLinkProvider),
    vscode.languages.registerCodeLensProvider(JAVA_SELECTOR, javaViewProvider.codeLensProvider),
    vscode.languages.registerDefinitionProvider(JAVA_SELECTOR, javaViewProvider.definitionProvider),
    vscode.languages.registerReferenceProvider(JAVA_SELECTOR, javaViewProvider.referenceProvider),
    vscode.languages.registerCompletionItemProvider(JAVA_SELECTOR, javaViewProvider.completionProvider, `"`, `/`),
  ];
  const watchers = [templateIndex.watch(), javaIndex.watch(), messageIndex.watch()];
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.command = `${MAIN}.openLogOutput`;
  const listeners = setupListeners(diagnosticProvider, javaViewProvider, documentModels, templateIndex, javaIndex, messageIndex, statusBar);

  // 초기 인덱싱 (열린 문서 재진단은 인덱스 갱신 이벤트의 refresh 가 1회 수행)
  scanIndexes(templateIndex, javaIndex, messageIndex).then(([templates, javaFiles, messages]) => {
    logger(`info`, `activate - ${templates} templates, ${javaFiles} Java files, ${messages} message keys indexed`);
    updateStatusBar(statusBar, templateIndex, javaIndex, messageIndex);
  }).catch((error) => {
    logger(`error`, `activate - initial indexing failed: ${error}`);
  });
  diagnosticProvider.applyOpenDocuments().catch((error) => {
    logger(`error`, `activate - initial diagnostics failed: ${error}`);
  });
  updateStatusBar(statusBar, templateIndex, javaIndex, messageIndex);

  context.subscriptions.push(...commands, ...providers, ...watchers, ...listeners, statusBar, {
    dispose: () => {
      templateIndex.dispose();
      javaIndex.dispose();
      messageIndex.dispose();
      diagnosticProvider.dispose();
      javaViewProvider.dispose();
    },
  });
};

// 1-3. 인덱스 스캔 (템플릿 먼저: Java·메시지 인덱싱 여부가 템플릿 존재에 의존)
const scanIndexes = async (templateIndex: TemplateIndexServiceType, javaIndex: JavaIndexServiceType, messageIndex: MessageIndexServiceType): Promise<[number, number, number]> => {
  const templates = await templateIndex.scan();
  const [javaFiles, messages] = await Promise.all([javaIndex.scan(), messageIndex.scan()]);
  return [templates, javaFiles, messages];
};

// 1-4. 상태바 갱신
const updateStatusBar = (statusBar: vscode.StatusBarItem, templateIndex: TemplateIndexServiceType, javaIndex: JavaIndexServiceType, messageIndex: MessageIndexServiceType): void => {
  const editor = vscode.window.activeTextEditor;
  const languageId = editor?.document.languageId;
  if (languageId !== `html` && languageId !== `java`) {
    statusBar.hide();
    return;
  }
  const scanning = javaIndex.isScanning() || !templateIndex.isReady();
  statusBar.text = scanning ? `$(sync~spin) Thymeleaf` : `$(symbol-structure) Thymeleaf`;
  statusBar.tooltip = [`Thymeleaf-Language-Support`, `templates: ${templateIndex.templateCount()}`, `controllers: ${javaIndex.controllerCount()} (${javaIndex.fileCount()} Java files)`, `message keys: ${messageIndex.keyCount()} (${messageIndex.fileCount()} files)`, `click to open the output channel`].join(`\n`);
  statusBar.show();
};

// 1-5. 문서·설정·인덱스 리스너
const setupListeners = (diagnosticProvider: ThymeleafDiagnosticProviderType, javaViewProvider: JavaViewProviderType, documentModels: DocumentModelServiceType, templateIndex: TemplateIndexServiceType, javaIndex: JavaIndexServiceType, messageIndex: MessageIndexServiceType, statusBar: vscode.StatusBarItem): vscode.Disposable[] => {
  const timers = new Map<string, NodeJS.Timeout>();
  let refreshTimer: NodeJS.Timeout | null = null;
  const applyDocument = (document: vscode.TextDocument): void => {
    const run = document.languageId === `html` ? diagnosticProvider.apply(document) : document.languageId === `java` ? javaViewProvider.apply(document) : Promise.resolve();
    run.catch((error) => {
      logger(`error`, `apply - diagnostics failed: ${error}`);
    });
  };
  const refreshAll = (): void => {
    refreshTimer && clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      javaViewProvider.refreshLenses();
      updateStatusBar(statusBar, templateIndex, javaIndex, messageIndex);
      Promise.all([diagnosticProvider.applyOpenDocuments(), javaViewProvider.applyOpenDocuments()]).catch((error) => {
        logger(`error`, `refresh - diagnostics failed: ${error}`);
      });
    }, INDEX_REFRESH_DEBOUNCE_MS);
  };

  const openListener = vscode.workspace.onDidOpenTextDocument(applyDocument);
  const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.languageId !== `html` && e.document.languageId !== `java`) {
      return;
    }
    const key = e.document.uri.toString();
    const pending = timers.get(key);
    pending && clearTimeout(pending);
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      applyDocument(e.document);
    }, CHANGE_DEBOUNCE_MS));
  });
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    const key = document.uri.toString();
    const pending = timers.get(key);
    pending && clearTimeout(pending);
    timers.delete(key);
    diagnosticProvider.clear(document);
    javaViewProvider.clear(document);
    documentModels.evictDocument(document.uri);
  });
  const editorListener = vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar(statusBar, templateIndex, javaIndex, messageIndex));
  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration(MAIN)) {
      return;
    }
    logger(`debug`, `activate - configuration changed`);
    const needsRescan = [`templateGlobs`, `staticGlobs`, `javaGlobs`, `javaEnabled`, `messageGlobs`, `searchExclude`].some((key) => e.affectsConfiguration(`${MAIN}.${key}`));
    needsRescan ? scanIndexes(templateIndex, javaIndex, messageIndex).then(refreshAll).catch((error) => {
          logger(`error`, `config - rescan failed: ${error}`);
        }) : refreshAll();
  });
  // 템플릿이 처음 생기면 건너뛴 Java·메시지 인덱스를 스캔
  const templateListener = templateIndex.onDidUpdate(() => {
    refreshAll();
    if (templateIndex.templateCount() === 0) {
      return;
    }
    const skippedScans = [javaIndex.isSkipped() ? javaIndex.scan() : undefined, messageIndex.isSkipped() ? messageIndex.scan() : undefined].filter((task) => task !== undefined);
    skippedScans.length > 0 && Promise.all(skippedScans).catch((error) => {
      logger(`error`, `templates - deferred scan failed: ${error}`);
    });
  });
  const indexListeners = [templateListener, javaIndex.onDidUpdate(refreshAll), messageIndex.onDidUpdate(refreshAll)];
  const timerCleanup: vscode.Disposable = {
    dispose: () => {
      for (const pending of timers.values()) {
        clearTimeout(pending);
      }
      timers.clear();
      refreshTimer && clearTimeout(refreshTimer);
    },
  };

  return [openListener, changeListener, closeListener, editorListener, configListener, ...indexListeners, timerCleanup];
};
