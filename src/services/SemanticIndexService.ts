// services/SemanticIndexService.ts

import type { JavaIndexServiceType, MessageIndexServiceType, ModelAttributeType, ModelContextType, SemanticIndexType, TemplateIndexServiceType } from "@exportTypes";

// ------------------------------------------------------------------------------
// 1. 시맨틱 인덱스 어댑터 (Java·메시지·템플릿 인덱스 결합)
// ------------------------------------------------------------------------------
export const SemanticIndexService = (javaIndex: JavaIndexServiceType, messageIndex: MessageIndexServiceType, templateIndex: TemplateIndexServiceType): SemanticIndexType => {
  // 1-1. 템플릿 + 포함자(includer) 모델 병합
  const modelContextFor = (templateName: string | undefined): ModelContextType => {
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
    return { "mapped": mapped, "dynamic": dynamic, "attributes": merged };
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
