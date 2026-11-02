// services/DocumentModelService.ts

import type { vscode } from "@exportLibs";
import { buildScopes, parseTemplate } from "@exportModels";
import type { ScopeType, TemplateModelType } from "@exportTypes";

const MAX_DOCUMENTS = 32;

export interface DocumentModelType {
  version: number;
  template: TemplateModelType;
  scopes: Map<number, ScopeType>;
}

// ------------------------------------------------------------------------------
// 1. 열린 HTML 문서 파싱 캐시 (진단·언어 기능 공유, 버전 키, 최근 사용 순 제한)
// ------------------------------------------------------------------------------
export const DocumentModelService = () => {
  // 0. 변수 설정 ----------------------------------------------------------------------------
  const cache = new Map<string, DocumentModelType>();

  // 1-1. 문서 파싱 (같은 버전이면 재사용, 초과 시 가장 오래 쓰지 않은 문서 제거)
  const parseDocument = (document: vscode.TextDocument): DocumentModelType => {
    const key = document.uri.toString();
    const cached = cache.get(key);
    if (cached && cached.version === document.version) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    const template = parseTemplate(document.getText());
    const model: DocumentModelType = { "version": document.version, "template": template, "scopes": buildScopes(template) };
    cache.delete(key);
    cache.set(key, model);
    while (cache.size > MAX_DOCUMENTS) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      cache.delete(oldest);
    }
    return model;
  };

  // 1-2. 문서 닫힘·전체 초기화
  const evictDocument = (uri: vscode.Uri): void => {
    cache.delete(uri.toString());
  };
  const clear = (): void => cache.clear();

  return { parseDocument, evictDocument, clear };
};
