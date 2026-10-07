"use strict";
// test/suite/index.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const mocha_1 = __importDefault(require("mocha"));
// 1. e2e 스위트 실행 (확장 호스트 내부, 결과를 리포트 파일로 기록) --------------------------------
const run = () => {
    const mocha = new mocha_1.default({ "ui": `bdd`, "color": false, "timeout": 30_000 });
    const suiteDir = __dirname;
    const reportPath = node_path_1.default.join(suiteDir, `..`, `e2e-report.json`);
    const cases = [];
    for (const file of (0, node_fs_1.readdirSync)(suiteDir).filter((name) => name.endsWith(`.e2e.js`))) {
        mocha.addFile(node_path_1.default.join(suiteDir, file));
    }
    return new Promise((resolve, reject) => {
        const runner = mocha.run((failures) => {
            (0, node_fs_1.writeFileSync)(reportPath, JSON.stringify(cases, null, 2));
            failures > 0 ? reject(new Error(`${failures} e2e tests failed.`)) : resolve();
        });
        runner.on(`pass`, (test) => {
            cases.push({ "title": test.fullTitle(), "state": `passed`, "durationMs": test.duration ?? 0 });
        });
        runner.on(`fail`, (test, error) => {
            const message = error instanceof Error ? `${error.message}\n${error.stack ?? ``}` : String(error);
            cases.push({ "title": test.fullTitle(), "state": `failed`, "durationMs": test.duration ?? 0, "error": message });
        });
    });
};
exports.run = run;
//# sourceMappingURL=index.js.map