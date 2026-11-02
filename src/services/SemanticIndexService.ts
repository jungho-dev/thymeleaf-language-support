// services/SemanticIndexService.ts

import type { JavaIndexServiceType, MessageIndexServiceType, ModelAttributeType, ModelContextType, SemanticIndexType, TemplateIndexServiceType } from "@exportTypes";

// ------------------------------------------------------------------------------
// 1. 시맨틱 인덱스 어댑터 (Java·메시지·템플릿 인덱스 결합)
// ------------------------------------------------------------------------------
export const SemanticIndexService = (javaIndex: JavaIndexServiceType, messageIndex: MessageIndexServiceType, templateIndex: TemplateIndexServiceType): SemanticIndexType => {
  // 0. 변수 설정 (인덱스 revision 이 바뀌면 캐시 전체 폐기) ------------------------------------------------
  const contextCache = new Map<string, ModelContextType>();
  let cacheKey = ``;

  // 1-1. 템플릿 + 포함자(includer) 모델 병합 (체인마다 호출되므로 템플릿당 1회 생성 후 재사용)
  const modelContextFor = (templateName: string | undefined): ModelContextType => {
    const currentKey = `${javaIndex.isReady()}:${javaIndex.revision()}:${templateIndex.revision()}`;
    if (currentKey !== cacheKey) {
      contextCache.clear();
      cacheKey = currentKey;
    }
    const cached = templateName ? contextCache.get(templateName) : undefined;
    if (cached) {
      return cached;
    }
    const base = javaIndex.modelContextFor(templateName);
    if (!templateName) {
      return base;
    }
    const merged = new Map<string, ModelAttributeType[]>(base.attributes);
    let mapped = base.mapped;
    let dynamic = base.dynamic;
    for (const includer of templateIndex.includersOf(templateName)) {
      const context = javaIndex.modelContextFor(includer);
      mapped ||= context.mapped;
      dynamic ||= context.dynamic;
      for (const [name, attributes] of context.attributes) {
        merged.set(name, [...(merged.get(name) ?? []), ...attributes]);
      }
    }
    const context: ModelContextType = { "mapped": mapped, "dynamic": dynamic, "attributes": merged };
    contextCache.set(templateName, context);
    return context;
  };

  return {
    modelContextFor,
    "resolveJavaType": (simpleName) => javaIndex.resolveJavaType(simpleName),
    "hasMessages": () => messageIndex.hasMessages(),
    "findMessages": (key) => messageIndex.findMessages(key),
    "hasLinks": () => javaIndex.hasLinks() || templateIndex.hasStatic(),
    "linkExists": (path) => javaIndex.linkExists(path) || templateIndex.staticExists(path),
    "fragmentCatalog": (templateName) => templateIndex.fragmentCatalog(templateName),
  };
};
