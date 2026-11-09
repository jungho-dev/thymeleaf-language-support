// services/TemplateIndexService.ts

import { TextDecoder, vscode } from "@exportLibs";
import { buildLineStarts, matchesGlob, offsetToPosition, parseTemplate, templateNameFromPath } from "@exportModels";
import { logger } from "@exportScripts";
import type { FragmentCatalogType, TemplateModelType, TextPositionType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const MAX_CANDIDATES = 20;
const MAX_TEMPLATES = 3000;
const MAX_STATIC = 5000;
const READ_CHUNK = 32;
const SOURCE_PATH_PATTERN = /[\\/]src[\\/]/;
const UPDATE_DEBOUNCE_MS = 300;
const ID_SELECTOR_PATTERN = /^#([\w-]+)$/;
const FRAGMENT_NAME_PATTERN = /^[\w$-]+$/;
const FRAGMENT_REF_NAMES: ReadonlySet<string> = new Set([`insert`, `replace`, `include`, `substituteby`, `decorate`, `decorator`]);

// 인덱스는 AST 전체 대신 카탈로그·참조·루트 식별자 사용처만 보관 (메모리 절감)
interface TemplateEntryType {
  name: string;
  uri: vscode.Uri;
  catalog: FragmentCatalogType;
  references: string[];
  usages: AttributeUsageType[];
  fragmentArgs: [string, string[]][];
}
export interface AttributeUsageType {
  uri: vscode.Uri;
  templateName: string;
  name: string;
  offset: number;
  length: number;
  line: number;
  column: number;
}

// ------------------------------------------------------------------------------
// 1. 템플릿 파일 인덱스 (프래그먼트 카탈로그·포함 관계·정적 리소스)
// ------------------------------------------------------------------------------
export const TemplateIndexService = () => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const cache = new Map<string, vscode.Uri[]>();
  let entries = new Map<string, TemplateEntryType>();
  let byPath = new Map<string, string>();
  const includers = new Map<string, Set<string>>();
  const fragmentArgIndex = new Map<string, Set<string>>();
  let staticPaths = new Map<string, vscode.Uri>();
  let usageIndex: Map<string, AttributeUsageType[]> | undefined;
  const emitter = new vscode.EventEmitter<void>();
  const decoder = new TextDecoder(`utf-8`);
  let ready = false;
  let updateTimer: NodeJS.Timeout | null = null;
  let scanToken = 0;
  let revisionCount = 0;
  const pending = new Map<string, vscode.Uri | undefined>();

  // 1-1. 설정 조회
  const getConfig = () => {
    const config = vscode.workspace.getConfiguration(MAIN);
    return {
      "templateGlobs": config.get<string[]>(`templateGlobs`, [`**/templates/**`]),
      "staticGlobs": config.get<string[]>(`staticGlobs`, [`**/src/main/resources/static/**`, `**/src/main/resources/public/**`, `**/src/main/resources/resources/**`, `**/src/main/resources/META-INF/resources/**`]),
      "searchExclude": config.get<string[]>(`searchExclude`, []),
    };
  };
  const excludeGlob = (): string | undefined => {
    const { searchExclude } = getConfig();
    return searchExclude.length > 0 ? `{${searchExclude.join(`,`)}}` : undefined;
  };

  // 1-2. 템플릿명 정규화·경로 변환
  const normalizeName = (name: string): string => name.trim().replace(/^\/+/, ``).replace(/\.html?$/i, ``);
  const templateNameOf = (uri: vscode.Uri): string | undefined => byPath.get(uri.fsPath) ?? templateNameFromPath(uri.fsPath, getConfig().templateGlobs);

  // 1-3. 템플릿 파싱·경량 엔트리 등록 (대상 Map 지정: 스캔은 새 Map, 감시는 현재 Map)
  const registerTemplate = (uri: vscode.Uri, text: string, targetEntries: Map<string, TemplateEntryType>, targetByPath: Map<string, string>): void => {
    const name = templateNameFromPath(uri.fsPath, getConfig().templateGlobs);
    if (!name) {
      return;
    }

    // 소스 경로 템플릿 우선
    const existing = targetEntries.get(name);
    if (existing && existing.uri.fsPath !== uri.fsPath && SOURCE_PATH_PATTERN.test(existing.uri.fsPath) && !SOURCE_PATH_PATTERN.test(uri.fsPath)) {
      return;
    }
    const template: TemplateModelType = parseTemplate(text);

    // 프래그먼트 참조 템플릿명·호출 지점 이름 인자 ("템플릿::프래그먼트" -> 인자명)
    const references = new Set<string>();
    const fragmentArgs: [string, string[]][] = [];
    for (const attribute of template.attributes) {
      if (!FRAGMENT_REF_NAMES.has(attribute.name)) {
        continue;
      }
      for (const node of attribute.parsed.expressions) {
        if (node.kind !== `fragment` || !node.template || node.template.dynamic) {
          continue;
        }
        const local = node.template.value === `` || node.template.value === `this`;
        local || references.add(normalizeName(node.template.value));
        const selector = node.selector && !node.selector.dynamic ? node.selector.value.trim() : ``;
        const argNames = node.args.map((arg) => arg.name).filter((argName) => argName !== ``);
        FRAGMENT_NAME_PATTERN.test(selector) && argNames.length > 0 && fragmentArgs.push([`${local ? name : normalizeName(node.template.value)}::${selector}`, argNames]);
      }
    }

    // 루트 식별자 사용처 (줄·열 선계산으로 문서 열기 없이 위치 제공)
    const lineStarts = buildLineStarts(text);
    const usages: AttributeUsageType[] = [];
    const nodes = [...template.attributes.flatMap((attribute) => attribute.parsed.expressions), ...template.inlines.flatMap((inline) => inline.parsed.expressions)];
    for (const node of nodes) {
      for (const chain of node.chains) {
        if (chain.root.kind !== `identifier`) {
          continue;
        }
        const position = offsetToPosition(lineStarts, chain.root.offset);
        usages.push({ "uri": uri, "templateName": name, "name": chain.root.name, "offset": chain.root.offset, "length": chain.root.length, "line": position.line, "column": position.column });
      }
    }

    // 같은 이름을 다른 파일이 대체하면 이전 경로 매핑 제거
    existing && existing.uri.fsPath !== uri.fsPath && targetByPath.delete(existing.uri.fsPath);
    targetEntries.set(name, { "name": name, "uri": uri, "catalog": { "fragments": template.fragments, "tagNames": template.tagNames, "ids": template.ids, "refs": template.refs }, "references": [...references], "usages": usages, "fragmentArgs": fragmentArgs });
    targetByPath.set(uri.fsPath, name);
  };
  const rebuildIncluders = (): void => {
    includers.clear();
    fragmentArgIndex.clear();
    for (const entry of entries.values()) {
      for (const reference of entry.references) {
        const set = includers.get(reference) ?? new Set<string>();
        set.add(entry.name);
        includers.set(reference, set);
      }
      for (const [key, argNames] of entry.fragmentArgs) {
        const names = fragmentArgIndex.get(key) ?? new Set<string>();
        argNames.forEach((argName) => names.add(argName));
        fragmentArgIndex.set(key, names);
      }
    }
    usageIndex = undefined;
    revisionCount++;
  };
  const indexTemplateUri = async (uri: vscode.Uri, targetEntries: Map<string, TemplateEntryType>, targetByPath: Map<string, string>): Promise<void> => {
    try {
      registerTemplate(uri, decoder.decode(await vscode.workspace.fs.readFile(uri)), targetEntries, targetByPath);
    }
    catch (error) {
      logger(`warn`, `indexTemplateUri - ${uri.fsPath}: ${error}`);
    }
  };

  // 1-4. 정적 리소스 경로 등록
  const staticPathOf = (fsPath: string, glob: string): string | undefined => {
    const marker = glob.split(`/`).filter((segment) => segment !== `` && !segment.includes(`*`)).at(-1);
    if (!marker) {
      return undefined;
    }
    const normalized = fsPath.replaceAll(`\\`, `/`);
    const index = normalized.lastIndexOf(`/${marker}/`);
    return index < 0 ? undefined : normalized.slice(index + marker.length + 1);
  };

  // 1-5. 전체 스캔 (새 Map 에 구성 후 교체, 늦게 끝난 이전 스캔은 폐기)
  const scan = async (): Promise<number> => {
    const token = ++scanToken;
    const { templateGlobs, staticGlobs } = getConfig();
    const nextEntries = new Map<string, TemplateEntryType>();
    const nextByPath = new Map<string, string>();
    const nextStatic = new Map<string, vscode.Uri>();
    const uris = new Map<string, vscode.Uri>();
    for (const glob of templateGlobs) {
      const prefix = glob.replace(/\/+$/, ``);
      for (const uri of await vscode.workspace.findFiles(`${prefix}/**/*.html`, excludeGlob(), MAX_TEMPLATES)) {
        uris.set(uri.fsPath, uri);
      }
    }
    const list = [...uris.values()];
    for (let start = 0; start < list.length; start += READ_CHUNK) {
      await Promise.all(list.slice(start, start + READ_CHUNK).map((uri) => indexTemplateUri(uri, nextEntries, nextByPath)));
    }
    for (const glob of staticGlobs) {
      for (const uri of await vscode.workspace.findFiles(glob, excludeGlob(), MAX_STATIC)) {
        const path = staticPathOf(uri.fsPath, glob);
        path && nextStatic.set(path, uri);
      }
    }
    if (token !== scanToken) {
      logger(`debug`, `scan - superseded by a newer scan`);
      return entries.size;
    }
    entries = nextEntries;
    byPath = nextByPath;
    staticPaths = nextStatic;
    cache.clear();
    rebuildIncluders();
    ready = true;
    emitter.fire();
    logger(`info`, `scan - ${entries.size} templates, ${staticPaths.size} static resources`);
    return entries.size;
  };

  // 1-6. 템플릿명 -> 후보 파일 조회 (인덱스 우선, 미등록은 findFiles)
  const findTemplateFiles = async (name: string): Promise<vscode.Uri[]> => {
    const normalized = normalizeName(name);
    if (normalized === `` || !/^[\w/.-]+$/.test(normalized)) {
      return [];
    }
    const indexed = entries.get(normalized);
    if (indexed) {
      return [indexed.uri];
    }
    const cached = cache.get(normalized);
    if (cached) {
      return cached;
    }
    const { templateGlobs } = getConfig();
    const found: vscode.Uri[] = [];
    for (const glob of templateGlobs) {
      const prefix = glob.replace(/\/+$/, ``);
      found.push(...await vscode.workspace.findFiles(`${prefix}/${normalized}.html`, excludeGlob(), MAX_CANDIDATES));
    }
    if (found.length === 0) {
      found.push(...await vscode.workspace.findFiles(`**/${normalized}.html`, excludeGlob(), MAX_CANDIDATES));
    }
    const unique = [...new Map(found.map((uri) => [uri.fsPath, uri])).values()];
    cache.set(normalized, unique);
    return unique;
  };

  // 1-7. 현재 문서와 가장 가까운 후보 선택
  const resolveTemplate = async (name: string, from?: vscode.Uri): Promise<vscode.Uri | undefined> => {
    const candidates = await findTemplateFiles(name);
    if (candidates.length <= 1 || !from) {
      return candidates[0];
    }
    const fromPath = from.fsPath.replaceAll(`\\`, `/`);
    let best = candidates[0];
    let bestShared = -1;
    for (const candidate of candidates) {
      const candidatePath = candidate.fsPath.replaceAll(`\\`, `/`);
      let shared = 0;
      while (shared < fromPath.length && shared < candidatePath.length && fromPath[shared] === candidatePath[shared]) {
        shared++;
      }
      if (shared > bestShared) {
        bestShared = shared;
        best = candidate;
      }
    }
    return best;
  };

  // 1-8. 문서 내 프래그먼트 선택자 위치 탐색 (열린 문서는 편집 내용, 아니면 파일 내용, 문서 열기 없음)
  const findFragmentPosition = async (uri: vscode.Uri, selector: string): Promise<TextPositionType> => {
    const trimmed = selector.trim();
    if (trimmed === ``) {
      return { "line": 0, "column": 0 };
    }
    const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    const text = openDocument ? openDocument.getText() : decoder.decode(await vscode.workspace.fs.readFile(uri));
    const lineStarts = buildLineStarts(text);
    const fragmentName = trimmed.split(`(`)[0].trim();
    const template = parseTemplate(text);
    const fragment = template.fragments.find((entry) => entry.name === fragmentName);
    if (fragment) {
      return offsetToPosition(lineStarts, fragment.offset);
    }
    const refAttribute = template.attributes.find((attribute) => attribute.prefix === `th` && attribute.name === `ref` && attribute.value.trim() === fragmentName);
    if (refAttribute) {
      return offsetToPosition(lineStarts, refAttribute.tagOffset);
    }
    const idMatch = ID_SELECTOR_PATTERN.exec(trimmed);
    const idElement = idMatch ? template.elements.find((candidate) => candidate.id === idMatch[1]) : undefined;
    if (idElement) {
      return offsetToPosition(lineStarts, idElement.offset);
    }
    const element = template.elements.find((candidate) => candidate.tag.toLowerCase() === fragmentName.toLowerCase());
    return element ? offsetToPosition(lineStarts, element.offset) : { "line": 0, "column": 0 };
  };

  // 2-1. 조회 API
  const fragmentCatalog = (templateName: string | undefined): FragmentCatalogType | undefined => (templateName ? entries.get(normalizeName(templateName))?.catalog : undefined);
  const includersOf = (templateName: string, depth = 3): string[] => {
    const visited = new Set<string>();
    const queue: { name: string; depth: number }[] = [{ "name": normalizeName(templateName), "depth": 0 }];
    while (queue.length > 0) {
      const current = queue.shift() as { name: string; depth: number };
      for (const includer of includers.get(current.name) ?? []) {
        if (!visited.has(includer) && current.depth < depth) {
          visited.add(includer);
          queue.push({ "name": includer, "depth": current.depth + 1 });
        }
      }
    }
    return [...visited];
  };
  const fragmentArgNames = (templateName: string | undefined, fragmentName: string): ReadonlySet<string> | undefined => (templateName ? fragmentArgIndex.get(`${normalizeName(templateName)}::${fragmentName}`) : undefined);
  const listTemplateNames = (): string[] => [...entries.keys()].sort();
  const templateUri = (templateName: string): vscode.Uri | undefined => entries.get(normalizeName(templateName))?.uri;

  // 사용처 인덱스는 변경 후 첫 조회 때 1회 재구성
  const attributeUsages = (attributeName: string): AttributeUsageType[] => {
    if (!usageIndex) {
      usageIndex = new Map();
      for (const entry of entries.values()) {
        for (const usage of entry.usages) {
          const usageList = usageIndex.get(usage.name) ?? [];
          usageList.push(usage);
          usageIndex.set(usage.name, usageList);
        }
      }
    }
    return usageIndex.get(attributeName) ?? [];
  };
  const hasStatic = (): boolean => staticPaths.size > 0;
  const staticExists = (path: string): boolean => staticPaths.has(path.split(/[?#]/)[0]);
  const staticUri = (path: string): vscode.Uri | undefined => staticPaths.get(path.split(/[?#]/)[0]);
  const listStaticPaths = (): string[] => [...staticPaths.keys()].sort();
  const isReady = (): boolean => ready;
  const templateCount = (): number => entries.size;
  const revision = (): number => revisionCount;

  // 2-2. 감시 (html·정적 리소스, 정적 경로는 확장자와 무관하게 정적 인덱스 갱신)
  const schedule = (uri: vscode.Uri, removed: boolean): void => {
    const { searchExclude } = getConfig();
    if (matchesGlob(vscode.workspace.asRelativePath(uri, false), searchExclude)) {
      return;
    }
    pending.set(uri.fsPath, removed ? undefined : uri);
    cache.clear();
    updateTimer && clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      updateTimer = null;
      const work = [...pending.entries()];
      pending.clear();
      const { staticGlobs } = getConfig();
      Promise.all(work.map(async ([fsPath, target]) => {
        const relativePath = vscode.workspace.asRelativePath(vscode.Uri.file(fsPath), false);
        const staticGlob = staticGlobs.find((glob) => matchesGlob(relativePath, [glob]));
        const staticPath = staticGlob ? staticPathOf(fsPath, staticGlob) : undefined;
        if (staticPath) {
          target ? staticPaths.set(staticPath, target) : staticPaths.delete(staticPath);
        }
        if (!/\.html?$/i.test(fsPath)) {
          return;
        }
        if (target) {
          await indexTemplateUri(target, entries, byPath);
          return;
        }
        const name = byPath.get(fsPath);
        name && entries.get(name)?.uri.fsPath === fsPath && entries.delete(name);
        byPath.delete(fsPath);
      })).then(() => {
        rebuildIncluders();
        emitter.fire();
      }).catch((error) => {
        logger(`error`, `watch - ${error}`);
      });
    }, UPDATE_DEBOUNCE_MS);
  };
  const watch = (): vscode.Disposable => {
    const htmlWatcher = vscode.workspace.createFileSystemWatcher(`**/*.html`);
    const staticWatcher = vscode.workspace.createFileSystemWatcher(`**/src/main/resources/{static,public,resources,META-INF/resources}/**`);
    htmlWatcher.onDidCreate((uri) => schedule(uri, false));
    htmlWatcher.onDidChange((uri) => schedule(uri, false));
    htmlWatcher.onDidDelete((uri) => schedule(uri, true));
    staticWatcher.onDidCreate((uri) => schedule(uri, false));
    staticWatcher.onDidDelete((uri) => schedule(uri, true));
    return vscode.Disposable.from(htmlWatcher, staticWatcher);
  };

  // 2-3. 캐시 초기화·해제
  const clear = (): void => cache.clear();
  const dispose = (): void => {
    updateTimer && clearTimeout(updateTimer);
    cache.clear();
    entries.clear();
    byPath.clear();
    staticPaths.clear();
    includers.clear();
    fragmentArgIndex.clear();
    usageIndex = undefined;
    emitter.dispose();
  };

  return { scan, findTemplateFiles, resolveTemplate, findFragmentPosition, templateNameOf, fragmentCatalog, fragmentArgNames, includersOf, listTemplateNames, templateUri, attributeUsages, hasStatic, staticExists, staticUri, listStaticPaths, isReady, templateCount, revision, "onDidUpdate": emitter.event, watch, clear, dispose };
};
