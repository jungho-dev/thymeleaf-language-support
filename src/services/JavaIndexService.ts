// services/JavaIndexService.ts

import { TextDecoder, vscode } from "@exportLibs";
import { isModelSource, matchesGlob, parseJavaFile, resolveAttributeTypes } from "@exportModels";
import { logger } from "@exportScripts";
import type { JavaFileType, JavaHandlerType, JavaTypeType, ModelAttributeType, ModelContextType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const MAX_JAVA_FILES = 6000;
const PARSE_CHUNK = 32;
const UPDATE_DEBOUNCE_MS = 400;
const TEST_PATH_PATTERN = /[\\/](test|tests)[\\/]/;
const ERROR_ATTRIBUTES = [`timestamp`, `status`, `error`, `exception`, `message`, `trace`, `path`, `errors`];

export interface HandlerRefType {
  type: JavaTypeType;
  handler: JavaHandlerType;
  fsPath: string;
}
interface UrlEntryType {
  pattern: RegExp;
  path: string;
  ref: HandlerRefType;
}

// ------------------------------------------------------------------------------
// 1. Java 소스 인덱스 (컨트롤러·뷰·모델 속성·클래스)
// ------------------------------------------------------------------------------
export const JavaIndexService = (isWanted: () => boolean = () => true) => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  let files = new Map<string, JavaFileType>();
  const typeIndex = new Map<string, { type: JavaTypeType; fsPath: string }[]>();
  const viewIndex = new Map<string, HandlerRefType[]>();
  const urlIndex: UrlEntryType[] = [];
  const globalTypes: JavaTypeType[] = [];
  const flashNames = new Map<string, ModelAttributeType[]>();
  const emitter = new vscode.EventEmitter<void>();
  const decoder = new TextDecoder(`utf-8`);
  let ready = false;
  let scanning = false;
  let skipped = false;
  let updateTimer: NodeJS.Timeout | null = null;
  let scanToken = 0;
  let revisionCount = 0;
  let controllerTotal = 0;
  const pendingUpdates = new Map<string, boolean>();

  // 1-1. 설정 조회
  const getConfig = () => {
    const config = vscode.workspace.getConfiguration(MAIN);
    return {
      "enabled": config.get<boolean>(`javaEnabled`, true),
      "javaGlobs": config.get<string[]>(`javaGlobs`, [`**/src/main/java/**/*.java`]),
      "searchExclude": config.get<string[]>(`searchExclude`, []),
    };
  };
  const excludeGlob = (): string | undefined => {
    const { searchExclude } = getConfig();
    return searchExclude.length > 0 ? `{${searchExclude.join(`,`)}}` : undefined;
  };

  // 1-2. 파일 읽기·파싱
  const readText = async (uri: vscode.Uri): Promise<string> => decoder.decode(await vscode.workspace.fs.readFile(uri));
  const lookupType = (simpleName: string): JavaTypeType | undefined => typeIndex.get(simpleName)?.[0]?.type;

  // 1-3. 파생 인덱스 재구성
  const rebuildDerived = (): void => {
    typeIndex.clear();
    viewIndex.clear();
    urlIndex.length = 0;
    globalTypes.length = 0;
    flashNames.clear();
    controllerTotal = 0;
    revisionCount++;
    for (const file of files.values()) {
      const isTest = TEST_PATH_PATTERN.test(file.fsPath);
      for (const type of file.types) {
        const entries = typeIndex.get(type.name) ?? [];
        isTest ? entries.push({ "type": type, "fsPath": file.fsPath }) : entries.unshift({ "type": type, "fsPath": file.fsPath });
        typeIndex.set(type.name, entries);
        (type.isControllerAdvice || type.isInterceptor) && globalTypes.push(type);
        (type.isController || type.isRestController) && controllerTotal++;
        for (const flash of type.flashAttributes) {
          const list = flashNames.get(flash.name) ?? [];
          list.push(flash);
          flashNames.set(flash.name, list);
        }
        for (const handler of type.handlers) {
          const ref: HandlerRefType = { "type": type, "handler": handler, "fsPath": file.fsPath };
          for (const view of handler.viewNames) {
            // 템플릿명과 같은 규칙으로 정규화 (return "main.html" -> main)
            const name = view.name.trim().replace(/^\/+/, ``).replace(/\.html?$/i, ``);
            const refs = viewIndex.get(name) ?? [];
            refs.push(ref);
            viewIndex.set(name, refs);
          }
          for (const path of handler.paths) {
            const escaped = path.replace(/[.+^$()|[\]\\]/g, `\\$&`).replaceAll(`**`, `@@ANY@@`).replace(/\*/g, `[^/]*`).replaceAll(`@@ANY@@`, `.*`).replace(/\{[^}]*\}/g, `[^/]+`);
            urlIndex.push({ "pattern": new RegExp(`^${escaped}/?$`), "path": path, "ref": ref });
          }
        }
      }
    }
  };

  // 1-4. 전체 스캔 (새 Map 에 구성 후 교체, 늦게 끝난 이전 스캔은 폐기)
  const scan = async (): Promise<number> => {
    const token = ++scanToken;
    const config = getConfig();
    if (!config.enabled || !isWanted()) {
      skipped = config.enabled;
      scanning = false;
      files = new Map();
      rebuildDerived();
      ready = true;
      emitter.fire();
      config.enabled && logger(`info`, `scan - skipped (no Thymeleaf templates indexed)`);
      return 0;
    }
    skipped = false;
    scanning = true;
    try {
      const uris = new Map<string, vscode.Uri>();
      for (const glob of config.javaGlobs) {
        for (const uri of await vscode.workspace.findFiles(glob, excludeGlob(), MAX_JAVA_FILES)) {
          uris.set(uri.fsPath, uri);
        }
      }
      const nextFiles = new Map<string, JavaFileType>();
      const parsedTexts: { file: JavaFileType; text: string }[] = [];
      const list = [...uris.values()];
      for (let start = 0; start < list.length; start += PARSE_CHUNK) {
        const chunk = list.slice(start, start + PARSE_CHUNK);
        const results = await Promise.all(chunk.map(async (uri) => {
          try {
            const text = await readText(uri);
            return { "file": parseJavaFile(text, uri.fsPath), "text": text };
          }
          catch (error) {
            logger(`warn`, `scan - failed to parse ${uri.fsPath}: ${error}`);
            return undefined;
          }
        }));
        for (const entry of results) {
          if (entry) {
            nextFiles.set(entry.file.fsPath, entry.file);
            entry.file.types.some(isModelSource) && parsedTexts.push(entry);
          }
        }
      }
      if (token !== scanToken) {
        logger(`debug`, `scan - superseded by a newer scan`);
        return files.size;
      }
      files = nextFiles;
      rebuildDerived();
      for (const entry of parsedTexts) {
        resolveAttributeTypes(entry.file, entry.text, lookupType);
      }
      ready = true;
      emitter.fire();
      logger(`info`, `scan - ${files.size} Java files indexed (${viewIndex.size} views, ${urlIndex.length} url patterns)`);
      return files.size;
    }
    finally {
      token === scanToken && (scanning = false);
    }
  };

  // 1-5. 변경 파일 일괄 갱신 (파생 인덱스는 배치당 1회 재구성)
  const applyUpdates = async (updates: [string, boolean][]): Promise<void> => {
    const parsedTexts: { file: JavaFileType; text: string }[] = [];
    for (let start = 0; start < updates.length; start += PARSE_CHUNK) {
      await Promise.all(updates.slice(start, start + PARSE_CHUNK).map(async ([fsPath, removed]) => {
        if (removed) {
          files.delete(fsPath);
          return;
        }
        try {
          const text = await readText(vscode.Uri.file(fsPath));
          const file = parseJavaFile(text, fsPath);
          files.set(fsPath, file);
          file.types.some(isModelSource) && parsedTexts.push({ "file": file, "text": text });
        }
        catch (error) {
          logger(`warn`, `applyUpdates - ${fsPath}: ${error}`);
        }
      }));
    }
    rebuildDerived();
    for (const entry of parsedTexts) {
      resolveAttributeTypes(entry.file, entry.text, lookupType);
    }
  };
  const updateFile = async (uri: vscode.Uri): Promise<void> => {
    await applyUpdates([[uri.fsPath, false]]);
  };
  const isIndexTarget = (uri: vscode.Uri): boolean => {
    const { enabled, javaGlobs, searchExclude } = getConfig();
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    return enabled && matchesGlob(relativePath, javaGlobs) && !matchesGlob(relativePath, searchExclude);
  };
  const scheduleUpdate = (uri: vscode.Uri, removed: boolean): void => {
    if (skipped || (!files.has(uri.fsPath) && !isIndexTarget(uri))) {
      return;
    }
    pendingUpdates.set(uri.fsPath, removed);
    updateTimer && clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      updateTimer = null;
      const updates = [...pendingUpdates.entries()];
      pendingUpdates.clear();
      applyUpdates(updates).then(() => emitter.fire()).catch((error) => {
        logger(`error`, `scheduleUpdate - ${error}`);
      });
    }, UPDATE_DEBOUNCE_MS);
  };

  // 2-1. 템플릿명 -> 모델 컨텍스트
  const modelContextFor = (templateName: string | undefined): ModelContextType => {
    const attributes = new Map<string, ModelAttributeType[]>();
    const add = (attribute: ModelAttributeType): void => {
      const list = attributes.get(attribute.name) ?? [];
      list.push(attribute);
      attributes.set(attribute.name, list);
    };
    if (!ready || !templateName) {
      return { "mapped": false, "dynamic": false, "attributes": attributes };
    }
    const refs = viewIndex.get(templateName) ?? [];
    if (refs.length === 0) {
      return { "mapped": false, "dynamic": false, "attributes": attributes };
    }
    let dynamic = false;
    const seenTypes = new Set<JavaTypeType>();
    for (const ref of refs) {
      dynamic ||= ref.handler.dynamic || ref.type.dynamicModel;
      ref.handler.attributes.forEach(add);
      if (!seenTypes.has(ref.type)) {
        seenTypes.add(ref.type);
        ref.type.classAttributes.forEach(add);
        ref.type.modelAttributeMethods.forEach(add);
        for (const name of ref.type.sessionAttributes) {
          add({ "name": name, "fsPath": ref.fsPath, "line": ref.type.line, "column": 0, "length": name.length, "offset": ref.type.offset, "source": `session`, "methodName": `` });
        }
      }
    }
    for (const globalType of globalTypes) {
      globalType.modelAttributeMethods.forEach(add);
      globalType.classAttributes.forEach(add);
      dynamic ||= globalType.dynamicModel;
    }
    for (const list of flashNames.values()) {
      list.forEach(add);
    }
    if (/^error(\/|$)/.test(templateName)) {
      for (const name of ERROR_ATTRIBUTES) {
        add({ "name": name, "fsPath": ``, "line": 0, "column": 0, "length": name.length, "offset": 0, "source": `addAttribute`, "methodName": `Spring Boot error attributes` });
      }
    }
    return { "mapped": true, "dynamic": dynamic, "attributes": attributes };
  };

  // 2-2. 조회 API
  // 단순 이름이 같은 비테스트 타입이 여럿이면 ambiguous (참조 쪽 import 문맥 없이는 어느 타입인지 알 수 없음)
  const resolveJavaType = (simpleName: string): { type: JavaTypeType; fsPath: string; ambiguous: boolean } | undefined => {
    const candidates = typeIndex.get(simpleName);
    if (!candidates || candidates.length === 0) {
      return undefined;
    }
    const qualifiedNames = new Set(candidates.filter((candidate) => !TEST_PATH_PATTERN.test(candidate.fsPath)).map((candidate) => candidate.type.qualifiedName));
    return { "type": candidates[0].type, "fsPath": candidates[0].fsPath, "ambiguous": qualifiedNames.size > 1 };
  };
  const viewRefs = (templateName: string): HandlerRefType[] => viewIndex.get(templateName) ?? [];
  const hasLinks = (): boolean => urlIndex.length > 0;
  const linkExists = (path: string): boolean => {
    const clean = path.split(/[?#]/)[0].replace(/\/+$/, ``) || `/`;
    return urlIndex.some((entry) => entry.pattern.test(clean));
  };
  const findHandlersForPath = (path: string): HandlerRefType[] => {
    const clean = path.split(/[?#]/)[0].replace(/\/+$/, ``) || `/`;
    return urlIndex.filter((entry) => entry.pattern.test(clean)).map((entry) => entry.ref);
  };
  const listUrls = (): string[] => [...new Set(urlIndex.map((entry) => entry.path))].sort();
  const listViewNames = (): string[] => [...viewIndex.keys()].sort();
  const isReady = (): boolean => ready;
  const isScanning = (): boolean => scanning;
  const isSkipped = (): boolean => skipped;
  const fileCount = (): number => files.size;
  const controllerCount = (): number => controllerTotal;
  const revision = (): number => revisionCount;

  // 2-3. 감시·해제
  const watch = (): vscode.Disposable => {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/*.java`);
    watcher.onDidCreate((uri) => scheduleUpdate(uri, false));
    watcher.onDidChange((uri) => scheduleUpdate(uri, false));
    watcher.onDidDelete((uri) => scheduleUpdate(uri, true));
    return watcher;
  };
  const dispose = (): void => {
    updateTimer && clearTimeout(updateTimer);
    files.clear();
    rebuildDerived();
    emitter.dispose();
  };

  return { scan, updateFile, modelContextFor, resolveJavaType, viewRefs, hasLinks, linkExists, findHandlersForPath, listUrls, listViewNames, isReady, isScanning, isSkipped, fileCount, controllerCount, revision, "onDidUpdate": emitter.event, watch, dispose };
};
