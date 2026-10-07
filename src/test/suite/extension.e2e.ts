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
const templateUri = (relative: string): vscode.Uri => vscode.Uri.file(path.join(workspaceRoot(), `src`, `main`, `resources`, `templates`, relative));
const javaUri = (relative: string): vscode.Uri => vscode.Uri.file(path.join(workspaceRoot(), `src`, `main`, `java`, relative));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async <T>(probe: () => T | undefined, timeoutMs = 20_000): Promise<T> => {
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
const labelsOf = (list: vscode.CompletionList): string[] => list.items.map((item) => (typeof item.label === `string` ? item.label : item.label.label));
const hoverText = (hovers: vscode.Hover[]): string => hovers.flatMap((hover) => hover.contents.map((content) => (typeof content === `string` ? content : content.value))).join(`\n`);

// 2. e2e 시나리오 ---------------------------------------------------------------------------
describe(`Thymeleaf-Language-Support e2e`, () => {
  it(`activates on an HTML document`, async () => {
    const document = await vscode.workspace.openTextDocument(templateUri(`index.html`));
    await vscode.window.showTextDocument(document);
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} is not installed in the test host`);
    await waitFor(() => (extension.isActive ? true : undefined));
  });

  it(`reports syntax and semantic diagnostics for a broken template`, async () => {
    const uri = templateUri(`broken.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const diagnostics = await waitFor(() => {
      const found = thymeleafDiagnostics(uri);
      return found.some((item) => item.code === `thymeleaf-unknown-model-attribute`) ? found : undefined;
    });
    const codes = diagnostics.map((item) => String(item.code));
    for (const expected of [`thymeleaf-unclosed-expression`, `thymeleaf-invalid-each`, `thymeleaf-deprecated-attribute`, `thymeleaf-unknown-attribute`, `thymeleaf-unknown-template`, `thymeleaf-unknown-property`, `thymeleaf-unknown-model-attribute`, `thymeleaf-unknown-message-key`, `thymeleaf-unknown-link`, `thymeleaf-expression-syntax`]) {
      assert.ok(codes.includes(expected), `missing ${expected} in: ${codes.join(`, `)}`);
    }
    const unknownProperty = diagnostics.find((item) => item.code === `thymeleaf-unknown-property`);
    assert.ok(unknownProperty);
    assert.strictEqual(document.getText(unknownProperty.range), `nmae`);
  });

  it(`reports no diagnostics for a valid template`, async () => {
    const uri = templateUri(`index.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await sleep(2000);
    const codes = thymeleafDiagnostics(uri).map((item) => `${item.code}: ${item.message}`);
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
    const labels = labelsOf(await vscode.commands.executeCommand<vscode.CompletionList>(`vscode.executeCompletionItemProvider`, uri, position));
    assert.ok(labels.includes(`th:each`), `labels: ${labels.slice(0, 10).join(`, `)}`);
    assert.ok(labels.includes(`th:text`));
    assert.ok(labels.includes(`th:replace`));
  });

  it(`completes model attributes, utility objects, and Java properties inside expressions`, async () => {
    const uri = templateUri(`index.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    const rootLabels = labelsOf(await vscode.commands.executeCommand<vscode.CompletionList>(`vscode.executeCompletionItemProvider`, uri, positionOf(document, `\${title}`, 2)));
    assert.ok(rootLabels.includes(`title`), `root labels: ${rootLabels.slice(0, 15).join(`, `)}`);
    assert.ok(rootLabels.includes(`items`));
    assert.ok(rootLabels.includes(`#strings`));
    const propertyLabels = labelsOf(await vscode.commands.executeCommand<vscode.CompletionList>(`vscode.executeCompletionItemProvider`, uri, positionOf(document, `\${user.name}`, `\${user.`.length)));
    assert.ok(propertyLabels.includes(`name`), `property labels: ${propertyLabels.join(`, `)}`);
    assert.ok(propertyLabels.includes(`email`));
    const eachLabels = labelsOf(await vscode.commands.executeCommand<vscode.CompletionList>(`vscode.executeCompletionItemProvider`, uri, positionOf(document, `\${item.name}`, `\${item.`.length)));
    assert.ok(eachLabels.includes(`active`), `each labels: ${eachLabels.join(`, `)}`);
  });

  it(`shows hover documentation for attributes and model attributes`, async () => {
    const uri = templateUri(`index.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    const attributeHover = hoverText(await vscode.commands.executeCommand<vscode.Hover[]>(`vscode.executeHoverProvider`, uri, positionOf(document, `th:each=`, 4)));
    assert.ok(attributeHover.includes(`th:each`), `hover: ${attributeHover}`);
    const modelHover = hoverText(await vscode.commands.executeCommand<vscode.Hover[]>(`vscode.executeHoverProvider`, uri, positionOf(document, `\${user.name}`, 3)));
    assert.ok(modelHover.includes(`User user`), `hover: ${modelHover}`);
    assert.ok(modelHover.includes(`HomeController.java`), `hover: ${modelHover}`);
  });

  it(`lists fragments as document symbols`, async () => {
    const uri = templateUri(`fragments/footer.html`);
    await vscode.workspace.openTextDocument(uri);
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(`vscode.executeDocumentSymbolProvider`, uri);
    const names = symbols.map((symbol) => symbol.name);
    assert.ok(names.includes(`copy`), `symbols: ${names.join(`, `)}`);
    assert.ok(names.includes(`links`), `symbols: ${names.join(`, `)}`);
  });

  it(`resolves fragment, model attribute, message, and link definitions`, async () => {
    const uri = templateUri(`index.html`);
    const document = await vscode.workspace.openTextDocument(uri);
    const fragment = await vscode.commands.executeCommand<vscode.Location[]>(`vscode.executeDefinitionProvider`, uri, positionOf(document, `fragments/footer :: copy`, 3));
    assert.strictEqual(fragment.length, 1);
    assert.ok(fragment[0].uri.fsPath.replaceAll(`\\`, `/`).endsWith(`templates/fragments/footer.html`));
    const model = await vscode.commands.executeCommand<vscode.Location[]>(`vscode.executeDefinitionProvider`, uri, positionOf(document, `\${user.name}`, 3));
    assert.ok(model.some((location) => location.uri.fsPath.endsWith(`HomeController.java`)), `model definitions: ${model.map((location) => location.uri.fsPath).join(`, `)}`);
    const message = await vscode.commands.executeCommand<vscode.Location[]>(`vscode.executeDefinitionProvider`, uri, positionOf(document, `home.welcome`, 2));
    assert.ok(message.some((location) => location.uri.fsPath.endsWith(`messages.properties`)));
    const link = await vscode.commands.executeCommand<vscode.Location[]>(`vscode.executeDefinitionProvider`, uri, positionOf(document, `/items/{id}`, 2));
    assert.ok(link.some((location) => location.uri.fsPath.endsWith(`HomeController.java`)), `link definitions: ${link.map((location) => location.uri.fsPath).join(`, `)}`);
  });

  it(`provides Java-side view CodeLens, diagnostics, and definition`, async () => {
    const uri = javaUri(path.join(`com`, `example`, `web`, `HomeController.java`));
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const missing = await waitFor(() => {
      const found = thymeleafDiagnostics(uri);
      return found.some((item) => item.code === `thymeleaf-missing-view`) ? found : undefined;
    });
    assert.strictEqual(document.getText(missing[0].range), `missing/view`);
    const lenses = await waitFor(() => {
      const found = vscode.commands.executeCommand<vscode.CodeLens[]>(`vscode.executeCodeLensProvider`, uri);
      return found;
    });
    const resolved = await lenses;
    assert.ok(resolved.some((lens) => lens.command?.title.includes(`open index`)), `lenses: ${resolved.map((lens) => lens.command?.title).join(` | `)}`);
    const definitions = await vscode.commands.executeCommand<vscode.Location[]>(`vscode.executeDefinitionProvider`, uri, positionOf(document, `return "index"`, `return "`.length + 1));
    assert.ok(definitions.some((location) => location.uri.fsPath.endsWith(`index.html`)), `definitions: ${definitions.map((location) => location.uri.fsPath).join(`, `)}`);
  });
});
