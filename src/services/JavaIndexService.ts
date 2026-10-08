// services/JavaIndexService.ts

import { TextDecoder, vscode } from "@exportLibs";
import { isModelSource, matchesGlob, parseJavaFile, resolveAttributeTypes } from "@exportModels";
import { logger } from "@exportScripts";
import type { JavaFileType, JavaHandlerType, JavaTypeType, ModelAttributeType, ModelContextType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const MAX_JAVA_FILES = 6000;
const PARSE_CHUNK = 32;
const UPDATE_DEBOUNCE_MS = 400;
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
export const JavaIndexService = () => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const files = new Map<string, JavaFileType>();
  const typeIndex = new Map<string, { type: JavaTypeType; fsPath: string }[]>();
  const viewIndex = new Map<string, HandlerRefType[]>();
  const urlIndex: UrlEntryType[] = [];
  const globalTypes: JavaTypeType[] = [];
  const flashNames = new Map<string, ModelAttributeType[]>();
  const emitter = new vscode.EventEmitter<void>();
  const decoder = new TextDecoder(`utf-8`);
  let ready = false;
  let scanning = false;
  let updateTimer: NodeJS.Timeout | null = null;
  const pendingUpdates = new Set<string>();

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
  const indexFile = (file: JavaFileType): void => {
    files.set(file.fsPath, file);
  };

  // 1-3. 파생 인덱스 재구성
  const rebuildDerived = (): void => {
    typeIndex.clear();
    viewIndex.clear();
    urlIndex.length = 0;
    globalTypes.length = 0;
    flashNames.clear();
    for (const file of files.values()) {
      const isTest = /[\\/](test|tests)[\\/]/.test(file.fsPath);
      for (const type of file.types) {
        const entries = typeIndex.get(type.name) ?? [];
        isTest ? entries.push({ "type": type, "fsPath": file.fsPath }) : entries.unshift({ "type": type, "fsPath": file.fsPath });
        typeIndex.set(type.name, entries);
        (type.isControllerAdvice || type.isInterceptor) && globalTypes.push(type);
        for (const flash of type.flashAttributes) {
          const list = flashNames.get(flash.name) ?? [];
          list.push(flash);
          flashNames.set(flash.name, list);
        }
        for (const handler of type.handlers) {
          const ref: HandlerRefType = { "type": type, "handler": handler, "fsPath": file.fsPath };
          for (const view of handler.viewNames) {
            const name = view.name.replace(/^\/+/, ``);
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

  // 1-4. 전체 스캔
  const scan = async (): Promise<number> => {
    const config = getConfig();
    files.clear();
    if (!config.enabled) {
      rebuildDerived();
      ready = true;
      emitter.fire();
      return 0;
    }
    scanning = true;
    const uris = new Map<string, vscode.Uri>();
    for (const glob of config.javaGlobs) {
      for (const uri of await vscode.workspace.findFiles(glob, excludeGlob(), MAX_JAVA_FILES)) {
        uris.set(uri.fsPath, uri);
      }
    }
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
          indexFile(entry.file);
          entry.file.types.some(isModelSource) && parsedTexts.push(entry);
        }
      }
    }
    rebuildDerived();
    for (const entry of parsedTexts) {
      resolveAttributeTypes(entry.file, entry.text, lookupType);
    }
    scanning = false;
    ready = true;
    emitter.fire();
    logger(`info`, `scan - ${files.size} Java files indexed (${viewIndex.size} views, ${urlIndex.length} url patterns)`);
    return files.size;
  };

  // 1-5. 단일 파일 갱신
  const updateFile = async (uri: vscode.Uri): Promise<void> => {
    try {
      const text = await readText(uri);
      const file = parseJavaFile(text, uri.fsPath);
      indexFile(file);
      rebuildDerived();
      resolveAttributeTypes(file, text, lookupType);
    }
    catch (error) {
      logger(`warn`, `updateFile - ${uri.fsPath}: ${error}`);
    }
  };
  const removeFile = (uri: vscode.Uri): void => {
    files.delete(uri.fsPath) && rebuildDerived();
  };
  const isIndexTarget = (uri: vscode.Uri): boolean => {
    const { enabled, javaGlobs, searchExclude } = getConfig();
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    return enabled && matchesGlob(relativePath, javaGlobs) && !matchesGlob(relativePath, searchExclude);
  };
  const scheduleUpdate = (uri: vscode.Uri, removed: boolean): void => {
    if (!files.has(uri.fsPath) && !isIndexTarget(uri)) {
      return;
    }
    removed ? removeFile(uri) : pendingUpdates.add(uri.fsPath);
    updateTimer && clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      updateTimer = null;
      const paths = [...pendingUpdates];
      pendingUpdates.clear();
      Promise.all(paths.map((fsPath) => updateFile(vscode.Uri.file(fsPath)))).then(() => emitter.fire()).catch((error) => {
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
  const resolveJavaType = (simpleName: string): { type: JavaTypeType; fsPath: string } | undefined => typeIndex.get(simpleName)?.[0];
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
  const fileCount = (): number => files.size;
  const controllerCount = (): number => [...files.values()].reduce((count, file) => count + file.types.filter((type) => type.isController || type.isRestController).length, 0);

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

  return { scan, updateFile, modelContextFor, resolveJavaType, viewRefs, hasLinks, linkExists, findHandlersForPath, listUrls, listViewNames, isReady, isScanning, fileCount, controllerCount, "onDidUpdate": emitter.event, watch, dispose };
};
