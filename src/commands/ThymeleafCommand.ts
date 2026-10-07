// commands/ThymeleafCommand.ts

import { vscode } from "@exportLibs";
import { logger, notify, showLogOutput } from "@exportScripts";
import type { JavaIndexServiceType, JavaViewProviderType, MessageIndexServiceType, TemplateIndexServiceType, ThymeleafDiagnosticProviderType, ThymeleafLanguageProviderType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;

interface CommandDepsType {
  templateIndex: TemplateIndexServiceType;
  javaIndex: JavaIndexServiceType;
  messageIndex: MessageIndexServiceType;
  diagnosticProvider: ThymeleafDiagnosticProviderType;
  languageProvider: ThymeleafLanguageProviderType;
  javaViewProvider: JavaViewProviderType;
}

// ------------------------------------------------------------------------------
// 1. Thymeleaf 명령
// ------------------------------------------------------------------------------
export const ThymeleafCommand = (deps: CommandDepsType) => {
  // 1-1. 현재 문서 재검증
  const validateDocument = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || (editor.document.languageId !== `html` && editor.document.languageId !== `java`)) {
      await notify(`warn`, `validate - requires an active HTML or Java editor.`);
      return;
    }
    deps.templateIndex.clear();
    editor.document.languageId === `html` ? await deps.diagnosticProvider.apply(editor.document) : await deps.javaViewProvider.apply(editor.document);
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
    const location = await deps.languageProvider.resolveReferenceAt(editor.document, editor.selection.active);
    if (!location) {
      await notify(`warn`, `gotoFragment - no resolvable fragment reference at the cursor.`);
      return;
    }
    await openLocation(location.uri.fsPath, location.range.start.line, location.range.start.character);
  };

  // 1-3. 파일 열기
  const openLocation = async (fsPath: string, line = 0, column = 0): Promise<void> => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
    const editor = await vscode.window.showTextDocument(document, { "preview": false });
    const position = new vscode.Position(Math.min(line, document.lineCount - 1), column);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  };

  // 1-4. 인덱스 재구성
  const rebuildIndex = async (): Promise<void> => {
    await vscode.window.withProgress({ "location": vscode.ProgressLocation.Window, "title": `Thymeleaf: rebuilding index` }, async () => {
      const [templates, javaFiles, messages] = await Promise.all([deps.templateIndex.scan(), deps.javaIndex.scan(), deps.messageIndex.scan()]);
      deps.languageProvider.clearCache();
      await deps.diagnosticProvider.applyOpenDocuments();
      await deps.javaViewProvider.applyOpenDocuments();
      logger(`info`, `rebuildIndex - ${templates} templates, ${javaFiles} Java files, ${messages} message keys`);
      await notify(`info`, `index rebuilt: ${templates} templates, ${javaFiles} Java files, ${messages} message keys.`);
    });
  };

  // 1-5. 명령 등록
  const registerCommands = (): vscode.Disposable[] => [
    vscode.commands.registerCommand(`${MAIN}.validate`, validateDocument),
    vscode.commands.registerCommand(`${MAIN}.gotoFragment`, gotoFragment),
    vscode.commands.registerCommand(`${MAIN}.openLogOutput`, showLogOutput),
    vscode.commands.registerCommand(`${MAIN}.rebuildIndex`, rebuildIndex),
    vscode.commands.registerCommand(`${MAIN}.openTemplate`, (fsPath: string, line?: number) => openLocation(fsPath, line ?? 0)),
    vscode.commands.registerCommand(`${MAIN}.showAttributeUsages`, (uri: vscode.Uri, position: vscode.Position, name: string) => deps.javaViewProvider.showAttributeUsages(uri, position, name)),
  ];

  return { registerCommands, validateDocument, gotoFragment, rebuildIndex, openLocation };
};
