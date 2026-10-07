// commands/ThymeleafCommand.ts

import { vscode } from "@exportLibs";
import { logger, notify, showLogOutput } from "@exportScripts";
import type { TemplateIndexServiceType, ThymeleafDiagnosticProviderType, ThymeleafLanguageProviderType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;

// ------------------------------------------------------------------------------
// 1. Thymeleaf 명령
// ------------------------------------------------------------------------------
export const ThymeleafCommand = (indexService: TemplateIndexServiceType, diagnosticProvider: ThymeleafDiagnosticProviderType, languageProvider: ThymeleafLanguageProviderType) => {
  // 1-1. 현재 문서 재검증
  const validateDocument = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId !== `html`) {
      await notify(`warn`, `validate - requires an active HTML editor.`);
      return;
    }
    indexService.clear();
    await diagnosticProvider.apply(editor.document);
    const count = vscode.languages.getDiagnostics(editor.document.uri).filter((item) => item.source === `Thymeleaf`).length;
    logger(`info`, `validate - ${editor.document.uri.fsPath}: ${count} diagnostics`);
    await notify(`info`, `validate - ${count} Thymeleaf diagnostics.`);
  };

  // 1-2. 커서 위치 프래그먼트 템플릿으로 이동
  const gotoFragment = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId !== `html`) {
      await notify(`warn`, `gotoFragment - requires an active HTML editor.`);
      return;
    }
    const location = await languageProvider.resolveReferenceAt(editor.document, editor.selection.active);
    if (!location) {
      await notify(`warn`, `gotoFragment - no resolvable fragment reference at the cursor.`);
      return;
    }
    const document = await vscode.workspace.openTextDocument(location.uri);
    const target = await vscode.window.showTextDocument(document, { "preview": false });
    target.selection = new vscode.Selection(location.range.start, location.range.start);
    target.revealRange(location.range, vscode.TextEditorRevealType.InCenter);
  };

  // 1-3. 명령 등록
  const registerCommands = (): vscode.Disposable[] => [
    vscode.commands.registerCommand(`${MAIN}.validate`, validateDocument),
    vscode.commands.registerCommand(`${MAIN}.gotoFragment`, gotoFragment),
    vscode.commands.registerCommand(`${MAIN}.openLogOutput`, showLogOutput),
  ];

  return { registerCommands, validateDocument, gotoFragment };
};
