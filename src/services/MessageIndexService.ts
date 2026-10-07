// services/MessageIndexService.ts

import { TextDecoder, vscode } from "@exportLibs";
import { parseProperties } from "@exportModels";
import { logger } from "@exportScripts";
import type { MessageEntryType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const MAX_FILES = 500;
const UPDATE_DEBOUNCE_MS = 400;

// ------------------------------------------------------------------------------
// 1. 메시지 번들 인덱스 (messages*.properties)
// ------------------------------------------------------------------------------
export const MessageIndexService = () => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const byFile = new Map<string, MessageEntryType[]>();
  const byKey = new Map<string, MessageEntryType[]>();
  const emitter = new vscode.EventEmitter<void>();
  const decoder = new TextDecoder(`utf-8`);
  let ready = false;
  let updateTimer: NodeJS.Timeout | null = null;

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

  // 1-3. 파일 파싱
  const indexUri = async (uri: vscode.Uri): Promise<void> => {
    try {
      const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
      byFile.set(uri.fsPath, parseProperties(text, uri.fsPath));
    }
    catch (error) {
      logger(`warn`, `indexUri - ${uri.fsPath}: ${error}`);
    }
  };

  // 1-4. 전체 스캔
  const scan = async (): Promise<number> => {
    const { messageGlobs, searchExclude } = getConfig();
    const exclude = searchExclude.length > 0 ? `{${searchExclude.join(`,`)}}` : undefined;
    byFile.clear();
    const seen = new Set<string>();
    for (const glob of messageGlobs) {
      for (const uri of await vscode.workspace.findFiles(glob, exclude, MAX_FILES)) {
        if (!seen.has(uri.fsPath)) {
          seen.add(uri.fsPath);
          await indexUri(uri);
        }
      }
    }
    rebuild();
    ready = true;
    emitter.fire();
    logger(`info`, `scan - ${byFile.size} message files, ${byKey.size} keys`);
    return byKey.size;
  };

  // 1-5. 감시 (debounce 후 변경 파일만 재파싱)
  const matchesConfiguredGlob = (uri: vscode.Uri): boolean => {
    const { messageGlobs } = getConfig();
    const normalized = uri.fsPath.replaceAll(`\\`, `/`);
    return messageGlobs.some((glob) => {
      const base = glob.split(`/`).at(-1) ?? ``;
      const prefix = base.replace(/\*.*$/, ``);
      const dirMarker = glob.split(`/`).filter((segment) => !segment.includes(`*`)).at(-1);
      return normalized.endsWith(`.properties`) && (normalized.split(`/`).at(-1) ?? ``).startsWith(prefix) && (!dirMarker || normalized.includes(`/${dirMarker}/`));
    });
  };
  const watch = (): vscode.Disposable => {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/*.properties`);
    const pending = new Map<string, vscode.Uri | undefined>();
    const schedule = (uri: vscode.Uri, removed: boolean): void => {
      if (!matchesConfiguredGlob(uri) && !byFile.has(uri.fsPath)) {
        return;
      }
      pending.set(uri.fsPath, removed ? undefined : uri);
      updateTimer && clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        updateTimer = null;
        const work = [...pending.entries()];
        pending.clear();
        Promise.all(work.map(([fsPath, target]) => (target ? indexUri(target) : Promise.resolve(byFile.delete(fsPath)).then(() => undefined)))).then(() => {
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
  const listEntries = (): MessageEntryType[] => [...byKey.values()].flat();
  const fileCount = (): number => byFile.size;
  const isReady = (): boolean => ready;
  const dispose = (): void => {
    updateTimer && clearTimeout(updateTimer);
    byFile.clear();
    byKey.clear();
    emitter.dispose();
  };

  return { scan, hasMessages, findMessages, listKeys, listEntries, fileCount, isReady, "onDidUpdate": emitter.event, watch, dispose };
};
