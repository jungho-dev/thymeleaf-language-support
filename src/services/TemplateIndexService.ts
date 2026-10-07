// services/TemplateIndexService.ts

import { vscode } from "@exportLibs";
import { parseTemplate } from "@exportModels";
import { logger } from "@exportScripts";
import type { TextPositionType } from "@exportTypes";

const MAIN = `Thymeleaf-Language-Support`;
const MAX_CANDIDATES = 20;
const ID_SELECTOR_PATTERN = /^#([\w-]+)$/;

// ------------------------------------------------------------------------------
// 1. 템플릿 파일 인덱스 (프래그먼트 참조 해석)
// ------------------------------------------------------------------------------
export const TemplateIndexService = () => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const cache = new Map<string, vscode.Uri[]>();

  // 1-1. 설정 조회
  const getConfig = () => {
    const config = vscode.workspace.getConfiguration(MAIN);
    return {
      "templateGlobs": config.get<string[]>(`templateGlobs`, [`**/templates/**`]),
      "searchExclude": config.get<string[]>(`searchExclude`, []),
    };
  };

  // 1-2. 템플릿명 정규화 (선행 슬래시·확장자 제거)
  const normalizeName = (name: string): string => name.trim().replace(/^\/+/, ``).replace(/\.html?$/i, ``);

  // 1-3. 템플릿명 -> 후보 파일 조회
  const findTemplateFiles = async (name: string): Promise<vscode.Uri[]> => {
    const normalized = normalizeName(name);
    if (normalized === `` || !/^[\w/.-]+$/.test(normalized)) {
      return [];
    }
    const cached = cache.get(normalized);
    if (cached) {
      return cached;
    }
    const { templateGlobs, searchExclude } = getConfig();
    const exclude = searchExclude.length > 0 ? `{${searchExclude.join(`,`)}}` : undefined;
    const found: vscode.Uri[] = [];
    for (const glob of templateGlobs) {
      const prefix = glob.replace(/\/+$/, ``);
      const pattern = `${prefix}/${normalized}.html`;
      const uris = await vscode.workspace.findFiles(pattern, exclude, MAX_CANDIDATES);
      found.push(...uris);
    }
    if (found.length === 0) {
      const uris = await vscode.workspace.findFiles(`**/${normalized}.html`, exclude, MAX_CANDIDATES);
      found.push(...uris);
    }
    const unique = [...new Map(found.map((uri) => [uri.fsPath, uri])).values()];
    cache.set(normalized, unique);
    logger(`debug`, `findTemplateFiles - ${normalized}: ${unique.length} candidates`);
    return unique;
  };

  // 1-4. 현재 문서와 가장 가까운 후보 선택
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

  // 1-5. 문서 내 프래그먼트 선택자 위치 탐색
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
    const idMatch = ID_SELECTOR_PATTERN.exec(trimmed);
    if (idMatch) {
      const idPattern = new RegExp(`\\bid\\s*=\\s*["']${idMatch[1]}["']`);
      const found = idPattern.exec(text);
      if (found) {
        const tagStart = text.lastIndexOf(`<`, found.index);
        const position = document.positionAt(Math.max(0, tagStart));
        return { "line": position.line, "column": position.character };
      }
    }
    return { "line": 0, "column": 0 };
  };

  // 1-6. 파일 생성·삭제 감시 (캐시 무효화)
  const watch = (): vscode.Disposable => {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/*.html`, false, true, false);
    const invalidate = () => cache.clear();
    watcher.onDidCreate(invalidate);
    watcher.onDidDelete(invalidate);
    return watcher;
  };

  // 1-7. 캐시 초기화·해제
  const clear = (): void => cache.clear();
  const dispose = (): void => cache.clear();

  return { findTemplateFiles, resolveTemplate, findFragmentPosition, watch, clear, dispose };
};
