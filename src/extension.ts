// extension.ts

import { ThymeleafCommand } from "@exportCommands";
import { vscode } from "@exportLibs";
import { JavaViewProvider, ThymeleafDiagnosticProvider, ThymeleafLanguageProvider } from "@exportProviders";
import { initLogger, logger } from "@exportScripts";
import { JavaIndexService, MessageIndexService, SemanticIndexService, TemplateIndexService } from "@exportServices";
import type { JavaIndexServiceType, JavaViewProviderType, MessageIndexServiceType, TemplateIndexServiceType, ThymeleafDiagnosticProviderType, ThymeleafLanguageProviderType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const CHANGE_DEBOUNCE_MS = 300;
const INDEX_REFRESH_DEBOUNCE_MS = 500;
const HTML_SELECTOR: vscode.DocumentSelector = { "language": `html` };
const JAVA_SELECTOR: vscode.DocumentSelector = { "language": `java` };

// 1-1. deactivate
export const deactivate = () => {};

// 1-2. activate
export const activate = (context: vscode.ExtensionContext) => {
  initLogger();
  logger(`info`, `Thymeleaf-Language-Support is now active!`);

  const templateIndex = TemplateIndexService();
  const javaIndex = JavaIndexService();
  const messageIndex = MessageIndexService();
  const semanticIndex = SemanticIndexService(javaIndex, messageIndex, templateIndex);
  const diagnosticProvider = ThymeleafDiagnosticProvider(templateIndex, javaIndex, semanticIndex);
  const languageProvider = ThymeleafLanguageProvider(templateIndex, javaIndex, messageIndex, semanticIndex);
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
  const listeners = setupListeners(diagnosticProvider, javaViewProvider, languageProvider, templateIndex, javaIndex, messageIndex, statusBar);

  // 초기 인덱싱 후 열린 문서 진단
  Promise.all([templateIndex.scan(), javaIndex.scan(), messageIndex.scan()]).then(async ([templates, javaFiles, messages]) => {
    logger(`info`, `activate - ${templates} templates, ${javaFiles} Java files, ${messages} message keys indexed`);
    await diagnosticProvider.applyOpenDocuments();
    await javaViewProvider.applyOpenDocuments();
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

// 1-3. 상태바 갱신
const updateStatusBar = (statusBar: vscode.StatusBarItem, templateIndex: TemplateIndexServiceType, javaIndex: JavaIndexServiceType, messageIndex: MessageIndexServiceType): void => {
  const editor = vscode.window.activeTextEditor;
  const languageId = editor?.document.languageId;
  if (languageId !== `html` && languageId !== `java`) {
    statusBar.hide();
    return;
  }
  const scanning = javaIndex.isScanning() || !templateIndex.isReady();
  statusBar.text = scanning ? `$(sync~spin) Thymeleaf` : `$(symbol-structure) Thymeleaf`;
  statusBar.tooltip = [`Thymeleaf-Language-Support`, `templates: ${templateIndex.templateCount()}`, `controllers: ${javaIndex.controllerCount()} (${javaIndex.fileCount()} Java files)`, `message keys: ${messageIndex.listKeys().length} (${messageIndex.fileCount()} files)`, `click to open the output channel`].join(`\n`);
  statusBar.show();
};

// 1-4. 문서·설정·인덱스 리스너
const setupListeners = (diagnosticProvider: ThymeleafDiagnosticProviderType, javaViewProvider: JavaViewProviderType, languageProvider: ThymeleafLanguageProviderType, templateIndex: TemplateIndexServiceType, javaIndex: JavaIndexServiceType, messageIndex: MessageIndexServiceType, statusBar: vscode.StatusBarItem): vscode.Disposable[] => {
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
      languageProvider.clearCache();
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
  });
  const editorListener = vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar(statusBar, templateIndex, javaIndex, messageIndex));
  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration(MAIN)) {
      return;
    }
    logger(`debug`, `activate - configuration changed`);
    const needsRescan = [`templateGlobs`, `staticGlobs`, `javaGlobs`, `javaEnabled`, `messageGlobs`, `searchExclude`].some((key) => e.affectsConfiguration(`${MAIN}.${key}`));
    needsRescan ? Promise.all([templateIndex.scan(), javaIndex.scan(), messageIndex.scan()]).then(refreshAll).catch((error) => {
          logger(`error`, `config - rescan failed: ${error}`);
        }) : refreshAll();
  });
  const indexListeners = [templateIndex.onDidUpdate(refreshAll), javaIndex.onDidUpdate(refreshAll), messageIndex.onDidUpdate(refreshAll)];
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
