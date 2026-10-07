"use strict";
// test/runTest.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const node_process_1 = __importDefault(require("node:process"));
const test_electron_1 = require("@vscode/test-electron");
// 1. PATH 의 codium 런처에서 VSCodium 실행 파일 추정 -------------------------------------------
const findLocalEditor = () => {
    const explicit = node_process_1.default.env.VSCODE_EXE;
    if (explicit && (0, node_fs_1.existsSync)(explicit)) {
        return explicit;
    }
    const launcherNames = node_process_1.default.platform === `win32` ? [`codium.cmd`, `code.cmd`] : [`codium`, `code`];
    const exeNames = node_process_1.default.platform === `win32` ? [`VSCodium.exe`, `Code.exe`] : [`codium`, `code`];
    for (const dir of (node_process_1.default.env.PATH ?? ``).split(node_path_1.default.delimiter)) {
        for (const launcher of launcherNames) {
            if (!(0, node_fs_1.existsSync)(node_path_1.default.join(dir, launcher))) {
                continue;
            }
            for (const exe of exeNames) {
                const candidate = node_path_1.default.resolve(dir, `..`, exe);
                if ((0, node_fs_1.existsSync)(candidate)) {
                    return candidate;
                }
            }
        }
    }
    return undefined;
};
// 2. 격리된 프로필로 확장 테스트 실행 ----------------------------------------------------------
const main = async () => {
    const extensionDevelopmentPath = node_path_1.default.resolve(__dirname, `..`);
    const extensionTestsPath = node_path_1.default.resolve(__dirname, `suite`, `index`);
    const workspacePath = node_path_1.default.resolve(extensionDevelopmentPath, `src`, `test`, `fixtures`, `workspace`);
    const userDataDir = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), `thymeleaf-e2e-user-`));
    const extensionsDir = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), `thymeleaf-e2e-ext-`));
    const reportPath = node_path_1.default.resolve(__dirname, `e2e-report.json`);
    const vscodeExecutablePath = findLocalEditor();
    console.log(`[e2e] editor: ${vscodeExecutablePath ?? `download (stable)`}`);
    (0, node_fs_1.rmSync)(reportPath, { "force": true });
    try {
        await (0, test_electron_1.runTests)({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath,
            "launchArgs": [workspacePath, `--disable-extensions`, `--disable-workspace-trust`, `--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`],
        });
    }
    finally {
        printReport(reportPath);
    }
};
// 3. 확장 호스트가 남긴 리포트 출력 -----------------------------------------------------------
const printReport = (reportPath) => {
    if (!(0, node_fs_1.existsSync)(reportPath)) {
        console.log(`[e2e] no report written (${reportPath})`);
        return;
    }
    const cases = JSON.parse((0, node_fs_1.readFileSync)(reportPath, `utf8`));
    for (const entry of cases) {
        console.log(`[e2e] ${entry.state === `passed` ? `PASS` : `FAIL`} ${entry.title} (${entry.durationMs}ms)`);
        entry.error && console.log(`       ${entry.error.split(`\n`).join(`\n       `)}`);
    }
    const failed = cases.filter((entry) => entry.state === `failed`).length;
    console.log(`[e2e] ${cases.length - failed} passed, ${failed} failed`);
};
main().catch((error) => {
    console.error(`[e2e] failed: ${error}`);
    node_process_1.default.exit(1);
});
//# sourceMappingURL=runTest.js.map