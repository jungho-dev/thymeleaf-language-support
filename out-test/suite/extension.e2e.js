"use strict";
// test/suite/extension.e2e.ts
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_path_1 = __importDefault(require("node:path"));
const vscode = __importStar(require("vscode"));
const EXTENSION_ID = `JUNGHO.thymeleaf-language-support`;
const POLL_MS = 200;
// 1. 헬퍼 ----------------------------------------------------------------------------------
const workspaceRoot = () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    node_assert_1.default.ok(folder, `workspace folder is required`);
    return folder.uri.fsPath;
};
const templateUri = (relative) => vscode.Uri.file(node_path_1.default.join(workspaceRoot(), `src`, `main`, `resources`, `templates`, relative));
const javaUri = (relative) => vscode.Uri.file(node_path_1.default.join(workspaceRoot(), `src`, `main`, `java`, relative));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (probe, timeoutMs = 20_000) => {
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
const thymeleafDiagnostics = (uri) => vscode.languages.getDiagnostics(uri).filter((item) => item.source === `Thymeleaf`);
const positionOf = (document, needle, offsetInNeedle = 0) => {
    const index = document.getText().indexOf(needle);
    node_assert_1.default.ok(index >= 0, `needle not found: ${needle}`);
    return document.positionAt(index + offsetInNeedle);
};
const labelsOf = (list) => list.items.map((item) => (typeof item.label === `string` ? item.label : item.label.label));
const hoverText = (hovers) => hovers.flatMap((hover) => hover.contents.map((content) => (typeof content === `string` ? content : content.value))).join(`\n`);
// 2. e2e 시나리오 ---------------------------------------------------------------------------
describe(`Thymeleaf-Language-Support e2e`, () => {
    it(`activates on an HTML document`, async () => {
        const document = await vscode.workspace.openTextDocument(templateUri(`index.html`));
        await vscode.window.showTextDocument(document);
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        node_assert_1.default.ok(extension, `extension ${EXTENSION_ID} is not installed in the test host`);
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
            node_assert_1.default.ok(codes.includes(expected), `missing ${expected} in: ${codes.join(`, `)}`);
        }
        const unknownProperty = diagnostics.find((item) => item.code === `thymeleaf-unknown-property`);
        node_assert_1.default.ok(unknownProperty);
        node_assert_1.default.strictEqual(document.getText(unknownProperty.range), `nmae`);
    });
    it(`reports no diagnostics for a valid template`, async () => {
        const uri = templateUri(`index.html`);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        await sleep(2000);
        const codes = thymeleafDiagnostics(uri).map((item) => `${item.code}: ${item.message}`);
        node_assert_1.default.deepStrictEqual(codes, []);
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
        const labels = labelsOf(await vscode.commands.executeCommand(`vscode.executeCompletionItemProvider`, uri, position));
        node_assert_1.default.ok(labels.includes(`th:each`), `labels: ${labels.slice(0, 10).join(`, `)}`);
        node_assert_1.default.ok(labels.includes(`th:text`));
        node_assert_1.default.ok(labels.includes(`th:replace`));
    });
    it(`completes model attributes, utility objects, and Java properties inside expressions`, async () => {
        const uri = templateUri(`index.html`);
        const document = await vscode.workspace.openTextDocument(uri);
        const rootLabels = labelsOf(await vscode.commands.executeCommand(`vscode.executeCompletionItemProvider`, uri, positionOf(document, `\${title}`, 2)));
        node_assert_1.default.ok(rootLabels.includes(`title`), `root labels: ${rootLabels.slice(0, 15).join(`, `)}`);
        node_assert_1.default.ok(rootLabels.includes(`items`));
        node_assert_1.default.ok(rootLabels.includes(`#strings`));
        const propertyLabels = labelsOf(await vscode.commands.executeCommand(`vscode.executeCompletionItemProvider`, uri, positionOf(document, `\${user.name}`, `\${user.`.length)));
        node_assert_1.default.ok(propertyLabels.includes(`name`), `property labels: ${propertyLabels.join(`, `)}`);
        node_assert_1.default.ok(propertyLabels.includes(`email`));
        const eachLabels = labelsOf(await vscode.commands.executeCommand(`vscode.executeCompletionItemProvider`, uri, positionOf(document, `\${item.name}`, `\${item.`.length)));
        node_assert_1.default.ok(eachLabels.includes(`active`), `each labels: ${eachLabels.join(`, `)}`);
    });
    it(`shows hover documentation for attributes and model attributes`, async () => {
        const uri = templateUri(`index.html`);
        const document = await vscode.workspace.openTextDocument(uri);
        const attributeHover = hoverText(await vscode.commands.executeCommand(`vscode.executeHoverProvider`, uri, positionOf(document, `th:each=`, 4)));
        node_assert_1.default.ok(attributeHover.includes(`th:each`), `hover: ${attributeHover}`);
        const modelHover = hoverText(await vscode.commands.executeCommand(`vscode.executeHoverProvider`, uri, positionOf(document, `\${user.name}`, 3)));
        node_assert_1.default.ok(modelHover.includes(`User user`), `hover: ${modelHover}`);
        node_assert_1.default.ok(modelHover.includes(`HomeController.java`), `hover: ${modelHover}`);
    });
    it(`lists fragments as document symbols`, async () => {
        const uri = templateUri(`fragments/footer.html`);
        await vscode.workspace.openTextDocument(uri);
        const symbols = await vscode.commands.executeCommand(`vscode.executeDocumentSymbolProvider`, uri);
        const names = symbols.map((symbol) => symbol.name);
        node_assert_1.default.ok(names.includes(`copy`), `symbols: ${names.join(`, `)}`);
        node_assert_1.default.ok(names.includes(`links`), `symbols: ${names.join(`, `)}`);
    });
    it(`resolves fragment, model attribute, message, and link definitions`, async () => {
        const uri = templateUri(`index.html`);
        const document = await vscode.workspace.openTextDocument(uri);
        const fragment = await vscode.commands.executeCommand(`vscode.executeDefinitionProvider`, uri, positionOf(document, `fragments/footer :: copy`, 3));
        node_assert_1.default.strictEqual(fragment.length, 1);
        node_assert_1.default.ok(fragment[0].uri.fsPath.replaceAll(`\\`, `/`).endsWith(`templates/fragments/footer.html`));
        const model = await vscode.commands.executeCommand(`vscode.executeDefinitionProvider`, uri, positionOf(document, `\${user.name}`, 3));
        node_assert_1.default.ok(model.some((location) => location.uri.fsPath.endsWith(`HomeController.java`)), `model definitions: ${model.map((location) => location.uri.fsPath).join(`, `)}`);
        const message = await vscode.commands.executeCommand(`vscode.executeDefinitionProvider`, uri, positionOf(document, `home.welcome`, 2));
        node_assert_1.default.ok(message.some((location) => location.uri.fsPath.endsWith(`messages.properties`)));
        const link = await vscode.commands.executeCommand(`vscode.executeDefinitionProvider`, uri, positionOf(document, `/items/{id}`, 2));
        node_assert_1.default.ok(link.some((location) => location.uri.fsPath.endsWith(`HomeController.java`)), `link definitions: ${link.map((location) => location.uri.fsPath).join(`, `)}`);
    });
    it(`provides Java-side view CodeLens, diagnostics, and definition`, async () => {
        const uri = javaUri(node_path_1.default.join(`com`, `example`, `web`, `HomeController.java`));
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        const missing = await waitFor(() => {
            const found = thymeleafDiagnostics(uri);
            return found.some((item) => item.code === `thymeleaf-missing-view`) ? found : undefined;
        });
        node_assert_1.default.strictEqual(document.getText(missing[0].range), `missing/view`);
        const lenses = await waitFor(() => {
            const found = vscode.commands.executeCommand(`vscode.executeCodeLensProvider`, uri);
            return found;
        });
        const resolved = await lenses;
        node_assert_1.default.ok(resolved.some((lens) => lens.command?.title.includes(`open index`)), `lenses: ${resolved.map((lens) => lens.command?.title).join(` | `)}`);
        const definitions = await vscode.commands.executeCommand(`vscode.executeDefinitionProvider`, uri, positionOf(document, `return "index"`, `return "`.length + 1));
        node_assert_1.default.ok(definitions.some((location) => location.uri.fsPath.endsWith(`index.html`)), `definitions: ${definitions.map((location) => location.uri.fsPath).join(`, `)}`);
    });
});
//# sourceMappingURL=extension.e2e.js.map