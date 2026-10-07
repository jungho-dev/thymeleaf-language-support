// test/runTest.ts

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { runTests } from "@vscode/test-electron";

// 1. PATH 의 codium 런처에서 VSCodium 실행 파일 추정 -------------------------------------------
const findLocalEditor = (): string | undefined => {
  const explicit = process.env.VSCODE_EXE;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }
  const launcherNames = process.platform === `win32` ? [`codium.cmd`, `code.cmd`] : [`codium`, `code`];
  const exeNames = process.platform === `win32` ? [`VSCodium.exe`, `Code.exe`] : [`codium`, `code`];
  for (const dir of (process.env.PATH ?? ``).split(path.delimiter)) {
    for (const launcher of launcherNames) {
      if (!existsSync(path.join(dir, launcher))) {
        continue;
      }
      for (const exe of exeNames) {
        const candidate = path.resolve(dir, `..`, exe);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return undefined;
};

// 2. 격리된 프로필로 확장 테스트 실행 ----------------------------------------------------------
const main = async (): Promise<void> => {
  const extensionDevelopmentPath = path.resolve(__dirname, `..`);
  const extensionTestsPath = path.resolve(__dirname, `suite`, `index`);
  const workspacePath = path.resolve(extensionDevelopmentPath, `src`, `test`, `fixtures`, `workspace`);
  const userDataDir = mkdtempSync(path.join(tmpdir(), `thymeleaf-e2e-user-`));
  const extensionsDir = mkdtempSync(path.join(tmpdir(), `thymeleaf-e2e-ext-`));
  const reportPath = path.resolve(__dirname, `e2e-report.json`);
  const vscodeExecutablePath = findLocalEditor();
  console.log(`[e2e] editor: ${vscodeExecutablePath ?? `download (stable)`}`);
  rmSync(reportPath, { "force": true });
  try {
    await runTests({
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
const printReport = (reportPath: string): void => {
  if (!existsSync(reportPath)) {
    console.log(`[e2e] no report written (${reportPath})`);
    return;
  }
  const cases = JSON.parse(readFileSync(reportPath, `utf8`)) as { title: string; state: string; durationMs: number; error?: string }[];
  for (const entry of cases) {
    console.log(`[e2e] ${entry.state === `passed` ? `PASS` : `FAIL`} ${entry.title} (${entry.durationMs}ms)`);
    entry.error && console.log(`       ${entry.error.split(`\n`).join(`\n       `)}`);
  }
  const failed = cases.filter((entry) => entry.state === `failed`).length;
  console.log(`[e2e] ${cases.length - failed} passed, ${failed} failed`);
};

main().catch((error) => {
  console.error(`[e2e] failed: ${error}`);
  process.exit(1);
});
