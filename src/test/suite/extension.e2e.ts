// test/suite/extension.e2e.ts

import assert from "node:assert";
import path from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = `JUNGHO.thymeleaf-language-support`;
const POLL_MS = 200;

// 1. 헬퍼 ----------------------------------------------------------------------------------
const workspaceRoot = (): string => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, `workspace folder is required`);
  return folder.uri.fsPath;
};
const templateUri = (relative: string): vscode.Uri => vscode.Uri.file(path.join(workspaceRoot(), `templates`, relative));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async <T>(probe: () => T | undefined, timeoutMs = 15_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = probe();
    if (found !== undefined) {
      return found;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
};
const thymeleafDiagnostics = (uri: vscode.Uri): vscode.Diagnostic[] => vscode.languages.getDiagnostics(uri).filter((item) => item.source === `Thymeleaf`);
const positionOf = (document: vscode.TextDocument, needle: string, offsetInNeedle = 0): vscode.Position => {
  const index = document.getText().indexOf(needle);
  assert.ok(index >= 0, `needle not found: ${needle}`);
  return document.positionAt(index + offsetInNeedle);
};

// 2. e2e 시나리오 ---------------------------------------------------------------------------
describe(`Thymeleaf-Language-Support e2e`, () => {
  it(`activates on an HTML document`, async () => {
    const document = await vscode.workspace.openTextDocument(templateUri(`index.html`));
    await vscode.window.showTextDocument(document);
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} is not installed in the test host`);
    await waitFor(() => (extension.isActive ? true : undefined));
  });

  it(`reports diagnostics for a broken template`, async () => {
    const uri = templateUri(`broken.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const diagnostics = await waitFor(() => {
      const found = thymeleafDiagnostics(uri);
      return found.some((item) => item.code === `thymeleaf-unknown-template`) ? found : undefined;
    });
    const codes = diagnostics.map((item) => String(item.code));
    assert.ok(codes.includes(`thymeleaf-unclosed-expression`), `codes: ${codes.join(`, `)}`);
    assert.ok(codes.includes(`thymeleaf-invalid-each`), `codes: ${codes.join(`, `)}`);
    assert.ok(codes.includes(`thymeleaf-deprecated-attribute`), `codes: ${codes.join(`, `)}`);
    assert.ok(codes.includes(`thymeleaf-unknown-attribute`), `codes: ${codes.join(`, `)}`);
    assert.ok(codes.includes(`thymeleaf-unknown-template`), `codes: ${codes.join(`, `)}`);
    const unclosed = diagnostics.find((item) => item.code === `thymeleaf-unclosed-expression`);
    assert.ok(unclosed);
    assert.strictEqual(document.getText(unclosed.range), `\${user.name`);
  });

  it(`reports no diagnostics for a valid template`, async () => {
    const uri = templateUri(`index.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await sleep(1500);
    const codes = thymeleafDiagnostics(uri).map((item) => String(item.code));
    assert.deepStrictEqual(codes, []);
  });

  it(`reacts to edits with updated diagnostics`, async () => {
    const uri = templateUri(`index.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const position = positionOf(document, `\${title}`, `\${title`.length);
    await editor.edit((builder) => builder.delete(new vscode.Range(position, position.translate(0, 1))));
    await waitFor(() => (thymeleafDiagnostics(uri).some((item) => item.code === `thymeleaf-unclosed-expression`) ? true : undefined));
    await vscode.commands.executeCommand(`undo`);
    await waitFor(() => (thymeleafDiagnostics(uri).length === 0 ? true : undefined));
  });

  it(`completes th: attribute names`, async () => {
    const uri = templateUri(`index.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    const position = positionOf(document, `th:text="\${title}"`, `th:`.length);
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(`vscode.executeCompletionItemProvider`, uri, position);
    const labels = list.items.map((item) => (typeof item.label === `string` ? item.label : item.label.label));
    assert.ok(labels.includes(`th:each`), `labels: ${labels.slice(0, 10).join(`, `)}`);
    assert.ok(labels.includes(`th:text`));
    assert.ok(labels.includes(`th:replace`));
  });

  it(`completes utility objects inside expressions`, async () => {
    const uri = templateUri(`index.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    const position = positionOf(document, `#lists.size(items)`, `#`.length);
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(`vscode.executeCompletionItemProvider`, uri, position);
    const labels = list.items.map((item) => (typeof item.label === `string` ? item.label : item.label.label));
    assert.ok(labels.includes(`#strings`), `labels: ${labels.slice(0, 10).join(`, `)}`);
    assert.ok(labels.includes(`#lists`));
  });

  it(`shows hover documentation for th:each`, async () => {
    const uri = templateUri(`index.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    const position = positionOf(document, `th:each=`, 4);
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(`vscode.executeHoverProvider`, uri, position);
    const text = hovers.flatMap((hover) => hover.contents.map((content) => (typeof content === `string` ? content : content.value))).join(`\n`);
    assert.ok(text.includes(`th:each`), `hover: ${text}`);
    assert.ok(text.toLowerCase().includes(`iterat`), `hover: ${text}`);
  });

  it(`lists fragments as document symbols`, async () => {
    const uri = templateUri(`fragments/footer.html`);
    await vscode.workspace.openTextDocument(uri);
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(`vscode.executeDocumentSymbolProvider`, uri);
    const names = symbols.map((symbol) => symbol.name);
    assert.ok(names.includes(`copy`), `symbols: ${names.join(`, `)}`);
    assert.ok(names.includes(`links`), `symbols: ${names.join(`, `)}`);
  });

  it(`resolves a fragment reference to its definition`, async () => {
    const uri = templateUri(`index.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    const position = positionOf(document, `fragments/footer :: copy`, 3);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(`vscode.executeDefinitionProvider`, uri, position);
    assert.strictEqual(locations.length, 1);
    assert.ok(locations[0].uri.fsPath.replaceAll(`\\`, `/`).endsWith(`templates/fragments/footer.html`));
    const target = await vscode.workspace.openTextDocument(locations[0].uri);
    assert.ok(target.lineAt(locations[0].range.start.line).text.includes(`th:fragment="copy`));
  });
});
