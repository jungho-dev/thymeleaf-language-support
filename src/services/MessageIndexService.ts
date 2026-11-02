// services/MessageIndexService.ts

import { TextDecoder, vscode } from "@exportLibs";
import { matchesGlob, parseProperties } from "@exportModels";
import { logger } from "@exportScripts";
import type { MessageEntryType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const MAX_FILES = 500;
const UPDATE_DEBOUNCE_MS = 400;

// ------------------------------------------------------------------------------
// 1. 메시지 번들 인덱스 (messages*.properties)
// ------------------------------------------------------------------------------
export const MessageIndexService = (isWanted: () => boolean = () => true) => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  let byFile = new Map<string, MessageEntryType[]>();
  const byKey = new Map<string, MessageEntryType[]>();
  const emitter = new vscode.EventEmitter<void>();
  const decoder = new TextDecoder(`utf-8`);
  let ready = false;
  let skipped = false;
  let updateTimer: NodeJS.Timeout | null = null;
  let scanToken = 0;

  // 1-1. 설정 조회
  const getConfig = () => {
    const config = vscode.workspace.getConfiguration(MAIN);
    return {
      "messageGlobs": config.get<string[]>(`messageGlobs`, [`**/src/main/resources/**/messages*.properties`, `**/src/main/resources/i18n/**/*.properties`]),
      "searchExclude": config.get<string[]>(`searchExclude`, []),
    };
  };

  // 1-2. 키 인덱스 재구성
  const rebuild = (): void => {
    byKey.clear();
    for (const entries of byFile.values()) {
      for (const entry of entries) {
        const list = byKey.get(entry.key) ?? [];
        list.push(entry);
        byKey.set(entry.key, list);
      }
    }
  };

  // 1-3. 파일 파싱 (대상 Map 지정: 스캔은 새 Map, 감시는 현재 Map)
  const indexUri = async (uri: vscode.Uri, target: Map<string, MessageEntryType[]>): Promise<void> => {
    try {
      const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
      target.set(uri.fsPath, parseProperties(text, uri.fsPath));
    }
    catch (error) {
      logger(`warn`, `indexUri - ${uri.fsPath}: ${error}`);
    }
  };

  // 1-4. 전체 스캔 (새 Map 에 구성 후 교체, 늦게 끝난 이전 스캔은 폐기)
  const scan = async (): Promise<number> => {
    const token = ++scanToken;
    const { messageGlobs, searchExclude } = getConfig();
    if (!isWanted()) {
      skipped = true;
      byFile = new Map();
      rebuild();
      ready = true;
      emitter.fire();
      return 0;
    }
    skipped = false;
    const exclude = searchExclude.length > 0 ? `{${searchExclude.join(`,`)}}` : undefined;
    const nextByFile = new Map<string, MessageEntryType[]>();
    const uris = new Map<string, vscode.Uri>();
    for (const glob of messageGlobs) {
      for (const uri of await vscode.workspace.findFiles(glob, exclude, MAX_FILES)) {
        uris.set(uri.fsPath, uri);
      }
    }
    await Promise.all([...uris.values()].map((uri) => indexUri(uri, nextByFile)));
    if (token !== scanToken) {
      return byKey.size;
    }
    byFile = nextByFile;
    rebuild();
    ready = true;
    emitter.fire();
    logger(`info`, `scan - ${byFile.size} message files, ${byKey.size} keys`);
    return byKey.size;
  };

  // 1-5. 감시 (debounce 후 변경 파일만 재파싱)
  const matchesConfiguredGlob = (uri: vscode.Uri): boolean => {
    const { messageGlobs, searchExclude } = getConfig();
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    return matchesGlob(relativePath, messageGlobs) && !matchesGlob(relativePath, searchExclude);
  };
  const watch = (): vscode.Disposable => {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/*.properties`);
    const pending = new Map<string, vscode.Uri | undefined>();
    const schedule = (uri: vscode.Uri, removed: boolean): void => {
      if (skipped || (!matchesConfiguredGlob(uri) && !byFile.has(uri.fsPath))) {
        return;
      }
      pending.set(uri.fsPath, removed ? undefined : uri);
      updateTimer && clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        updateTimer = null;
        const work = [...pending.entries()];
        pending.clear();
        Promise.all(work.map(([fsPath, target]) => (target ? indexUri(target, byFile) : Promise.resolve(byFile.delete(fsPath)).then(() => undefined)))).then(() => {
          rebuild();
          emitter.fire();
        }).catch((error) => {
          logger(`error`, `watch - ${error}`);
        });
      }, UPDATE_DEBOUNCE_MS);
    };
    watcher.onDidCreate((uri) => schedule(uri, false));
    watcher.onDidChange((uri) => schedule(uri, false));
    watcher.onDidDelete((uri) => schedule(uri, true));
    return watcher;
  };

  // 2-1. 조회 API
  const hasMessages = (): boolean => ready && byKey.size > 0;
  const findMessages = (key: string): MessageEntryType[] => byKey.get(key) ?? [];
  const listKeys = (): string[] => [...byKey.keys()];
  const keyCount = (): number => byKey.size;
  const listEntries = (): MessageEntryType[] => [...byKey.values()].flat();
  const fileCount = (): number => byFile.size;
  const isReady = (): boolean => ready;
  const isSkipped = (): boolean => skipped;
  const dispose = (): void => {
    updateTimer && clearTimeout(updateTimer);
    byFile.clear();
    byKey.clear();
    emitter.dispose();
  };

  return { scan, hasMessages, findMessages, listKeys, keyCount, listEntries, fileCount, isReady, isSkipped, "onDidUpdate": emitter.event, watch, dispose };
};
