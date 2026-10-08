// services/TemplateIndexService.ts

import { TextDecoder, vscode } from "@exportLibs";
import { matchesGlob, parseTemplate, templateNameFromPath } from "@exportModels";
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
const FRAGMENT_REF_NAMES: ReadonlySet<string> = new Set([`insert`, `replace`, `include`, `substituteby`, `decorate`, `decorator`]);

interface TemplateEntryType {
  name: string;
  uri: vscode.Uri;
  template: TemplateModelType;
  references: string[];
}
export interface AttributeUsageType {
  uri: vscode.Uri;
  templateName: string;
  offset: number;
  length: number;
}

// ------------------------------------------------------------------------------
// 1. 템플릿 파일 인덱스 (프래그먼트 카탈로그·포함 관계·정적 리소스)
// ------------------------------------------------------------------------------
export const TemplateIndexService = () => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const cache = new Map<string, vscode.Uri[]>();
  const entries = new Map<string, TemplateEntryType>();
  const byPath = new Map<string, string>();
  const includers = new Map<string, Set<string>>();
  const staticPaths = new Map<string, vscode.Uri>();
  const emitter = new vscode.EventEmitter<void>();
  const decoder = new TextDecoder(`utf-8`);
  let ready = false;
  let updateTimer: NodeJS.Timeout | null = null;
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
  const isExcluded = (uri: vscode.Uri): boolean => matchesGlob(vscode.workspace.asRelativePath(uri, false), getConfig().searchExclude);

  // 1-2. 템플릿명 정규화·경로 변환
  const normalizeName = (name: string): string => name.trim().replace(/^\/+/, ``).replace(/\.html?$/i, ``);
  const templateNameOf = (uri: vscode.Uri): string | undefined => byPath.get(uri.fsPath) ?? templateNameFromPath(uri.fsPath, getConfig().templateGlobs);

  // 1-3. 템플릿 파싱·등록
  const collectReferences = (template: TemplateModelType): string[] => {
    const names = new Set<string>();
    for (const attribute of template.attributes) {
      if (!FRAGMENT_REF_NAMES.has(attribute.name)) {
        continue;
      }
      for (const node of attribute.parsed.expressions) {
        node.kind === `fragment` && node.template && !node.template.dynamic && node.template.value !== `` && node.template.value !== `this` && names.add(normalizeName(node.template.value));
      }
    }
    return [...names];
  };
  const registerTemplate = (uri: vscode.Uri, text: string): void => {
    const name = templateNameFromPath(uri.fsPath, getConfig().templateGlobs);
    if (!name) {
      return;
    }

    // 소스 경로 템플릿 우선
    const existing = entries.get(name);
    if (existing && existing.uri.fsPath !== uri.fsPath && SOURCE_PATH_PATTERN.test(existing.uri.fsPath) && !SOURCE_PATH_PATTERN.test(uri.fsPath)) {
      return;
    }
    const template = parseTemplate(text);
    entries.set(name, { "name": name, "uri": uri, "template": template, "references": collectReferences(template) });
    byPath.set(uri.fsPath, name);
  };
  const rebuildIncluders = (): void => {
    includers.clear();
    for (const entry of entries.values()) {
      for (const reference of entry.references) {
        const set = includers.get(reference) ?? new Set<string>();
        set.add(entry.name);
        includers.set(reference, set);
      }
    }
  };
  const indexTemplateUri = async (uri: vscode.Uri): Promise<void> => {
    try {
      registerTemplate(uri, decoder.decode(await vscode.workspace.fs.readFile(uri)));
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

  // 1-5. 전체 스캔
  const scan = async (): Promise<number> => {
    const { templateGlobs, staticGlobs } = getConfig();
    entries.clear();
    byPath.clear();
    staticPaths.clear();
    cache.clear();
    const uris = new Map<string, vscode.Uri>();
    for (const glob of templateGlobs) {
      const prefix = glob.replace(/\/+$/, ``);
      for (const uri of await vscode.workspace.findFiles(`${prefix}/**/*.html`, excludeGlob(), MAX_TEMPLATES)) {
        uris.set(uri.fsPath, uri);
      }
    }
    const list = [...uris.values()];
    for (let start = 0; start < list.length; start += READ_CHUNK) {
      await Promise.all(list.slice(start, start + READ_CHUNK).map(indexTemplateUri));
    }
    for (const glob of staticGlobs) {
      for (const uri of await vscode.workspace.findFiles(glob, excludeGlob(), MAX_STATIC)) {
        const path = staticPathOf(uri.fsPath, glob);
        path && staticPaths.set(path, uri);
      }
    }
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

  // 1-8. 문서 내 프래그먼트 선택자 위치 탐색
  const findFragmentPosition = async (uri: vscode.Uri, selector: string): Promise<TextPositionType> => {
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const trimmed = selector.trim();
    if (trimmed === ``) {
      return { "line": 0, "column": 0 };
    }
    const fragmentName = trimmed.split(`(`)[0].trim();
    const template = parseTemplate(text);
    const fragment = template.fragments.find((entry) => entry.name === fragmentName);
    if (fragment) {
      const position = document.positionAt(fragment.offset);
      return { "line": position.line, "column": position.character };
    }
    const refAttribute = template.attributes.find((attribute) => attribute.prefix === `th` && attribute.name === `ref` && attribute.value.trim() === fragmentName);
    if (refAttribute) {
      const position = document.positionAt(refAttribute.tagOffset);
      return { "line": position.line, "column": position.character };
    }
    const idMatch = ID_SELECTOR_PATTERN.exec(trimmed);
    const idPattern = idMatch ? new RegExp(`\\bid\\s*=\\s*["']${idMatch[1]}["']`) : /^(?!)/;
    const found = idPattern.exec(text);
    if (found) {
      const position = document.positionAt(Math.max(0, text.lastIndexOf(`<`, found.index)));
      return { "line": position.line, "column": position.character };
    }
    const element = template.elements.find((candidate) => candidate.tag.toLowerCase() === fragmentName.toLowerCase());
    if (element) {
      const position = document.positionAt(element.offset);
      return { "line": position.line, "column": position.character };
    }
    return { "line": 0, "column": 0 };
  };

  // 2-1. 조회 API
  const fragmentCatalog = (templateName: string | undefined): FragmentCatalogType | undefined => {
    const entry = templateName ? entries.get(normalizeName(templateName)) : undefined;
    return entry ? { "fragments": entry.template.fragments, "tagNames": entry.template.tagNames, "ids": entry.template.ids, "refs": entry.template.refs } : undefined;
  };
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
  const listTemplateNames = (): string[] => [...entries.keys()].sort();
  const templateUri = (templateName: string): vscode.Uri | undefined => entries.get(normalizeName(templateName))?.uri;
  const attributeUsages = (attributeName: string): AttributeUsageType[] => {
    const usages: AttributeUsageType[] = [];
    for (const entry of entries.values()) {
      const nodes = [...entry.template.attributes.flatMap((attribute) => attribute.parsed.expressions), ...entry.template.inlines.flatMap((inline) => inline.parsed.expressions)];
      for (const node of nodes) {
        for (const chain of node.chains) {
          chain.root.kind === `identifier` && chain.root.name === attributeName && usages.push({ "uri": entry.uri, "templateName": entry.name, "offset": chain.root.offset, "length": chain.root.length });
        }
      }
    }
    return usages;
  };
  const hasStatic = (): boolean => staticPaths.size > 0;
  const staticExists = (path: string): boolean => staticPaths.has(path.split(/[?#]/)[0]);
  const staticUri = (path: string): vscode.Uri | undefined => staticPaths.get(path.split(/[?#]/)[0]);
  const listStaticPaths = (): string[] => [...staticPaths.keys()].sort();
  const isReady = (): boolean => ready;
  const templateCount = (): number => entries.size;

  // 2-2. 감시 (html·정적 리소스)
  const schedule = (uri: vscode.Uri, removed: boolean): void => {
    if (isExcluded(uri)) {
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
        const staticPath = staticGlobs.map((glob) => staticPathOf(fsPath, glob)).find((path) => path !== undefined);
        if (staticPath && !fsPath.endsWith(`.html`)) {
          target ? staticPaths.set(staticPath, target) : staticPaths.delete(staticPath);
          return;
        }
        if (!target) {
          const name = byPath.get(fsPath);
          name && entries.delete(name);
          byPath.delete(fsPath);
          return;
        }
        await indexTemplateUri(target);
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
    emitter.dispose();
  };

  return { scan, findTemplateFiles, resolveTemplate, findFragmentPosition, templateNameOf, fragmentCatalog, includersOf, listTemplateNames, templateUri, attributeUsages, hasStatic, staticExists, staticUri, listStaticPaths, isReady, templateCount, "onDidUpdate": emitter.event, watch, clear, dispose };
};
