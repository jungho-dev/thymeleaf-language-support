// test/suite/index.ts

import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Mocha from "mocha";

interface CaseReportType {
  title: string;
  state: `passed` | `failed`;
  durationMs: number;
  error?: string;
}

// 1. e2e 스위트 실행 (확장 호스트 내부, 결과를 리포트 파일로 기록) --------------------------------
export const run = (): Promise<void> => {
  const mocha = new Mocha({ "ui": `bdd`, "color": false, "timeout": 30_000 });
  const suiteDir = __dirname;
  const reportPath = path.join(suiteDir, `..`, `e2e-report.json`);
  const cases: CaseReportType[] = [];
  for (const file of readdirSync(suiteDir).filter((name) => name.endsWith(`.e2e.js`))) {
    mocha.addFile(path.join(suiteDir, file));
  }
  return new Promise((resolve, reject) => {
    const runner = mocha.run((failures) => {
      writeFileSync(reportPath, JSON.stringify(cases, null, 2));
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
