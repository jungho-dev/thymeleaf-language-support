// extension.ts

import { ThymeleafCommand } from "@exportCommands";
import { vscode } from "@exportLibs";
import { ThymeleafDiagnosticProvider, ThymeleafLanguageProvider } from "@exportProviders";
import { initLogger, logger } from "@exportScripts";
import { TemplateIndexService } from "@exportServices";
import type { ThymeleafDiagnosticProviderType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const CHANGE_DEBOUNCE_MS = 300;
const HTML_SELECTOR: vscode.DocumentSelector = { "language": `html` };

// 1-1. deactivate
export const deactivate = () => {};

// 1-2. activate
export const activate = (context: vscode.ExtensionContext) => {
  initLogger();
  logger(`info`, `Thymeleaf-Language-Support is now active!`);

  const indexService = TemplateIndexService();
  const diagnosticProvider = ThymeleafDiagnosticProvider(indexService);
  const languageProvider = ThymeleafLanguageProvider(indexService);
  const commandManager = ThymeleafCommand(indexService, diagnosticProvider, languageProvider);

  const commands = commandManager.registerCommands();
  const providers = [
    vscode.languages.registerCompletionItemProvider(HTML_SELECTOR, languageProvider.completionProvider, `:`, `-`, `#`),
    vscode.languages.registerHoverProvider(HTML_SELECTOR, languageProvider.hoverProvider),
    vscode.languages.registerDocumentSymbolProvider(HTML_SELECTOR, languageProvider.symbolProvider),
    vscode.languages.registerDefinitionProvider(HTML_SELECTOR, languageProvider.definitionProvider),
  ];
  const watcher = indexService.watch();
  const listeners = setupListeners(diagnosticProvider);

  diagnosticProvider.applyOpenDocuments().catch((error) => {
    logger(`error`, `activate - initial diagnostics failed: ${error}`);
  });

  context.subscriptions.push(...commands, ...providers, watcher, ...listeners, {
    dispose: () => {
      indexService.dispose();
      diagnosticProvider.dispose();
    },
  });
};

// 1-3. 문서·설정 리스너
const setupListeners = (diagnosticProvider: ThymeleafDiagnosticProviderType): vscode.Disposable[] => {
  const timers = new Map<string, NodeJS.Timeout>();

  const openListener = vscode.workspace.onDidOpenTextDocument((document) => {
    diagnosticProvider.apply(document).catch((error) => {
      logger(`error`, `open - diagnostics failed: ${error}`);
    });
  });

  const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.languageId !== `html`) {
      return;
    }
    const key = e.document.uri.toString();
    const pending = timers.get(key);
    pending && clearTimeout(pending);
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      diagnosticProvider.apply(e.document).catch((error) => {
        logger(`error`, `change - diagnostics failed: ${error}`);
      });
    }, CHANGE_DEBOUNCE_MS));
  });

  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    const key = document.uri.toString();
    const pending = timers.get(key);
    pending && clearTimeout(pending);
    timers.delete(key);
    diagnosticProvider.clear(document);
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration(MAIN)) {
      return;
    }
    logger(`debug`, `activate - configuration changed`);
    diagnosticProvider.applyOpenDocuments().catch((error) => {
      logger(`error`, `config - diagnostics failed: ${error}`);
    });
  });

  const timerCleanup: vscode.Disposable = {
    dispose: () => {
      for (const pending of timers.values()) {
        clearTimeout(pending);
      }
      timers.clear();
    },
  };

  return [openListener, changeListener, closeListener, configListener, timerCleanup];
};
