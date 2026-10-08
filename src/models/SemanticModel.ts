// models/SemanticModel.ts

import { simpleTypeName } from "@models/JavaModel";
import type { ExpressionChainType, ExpressionIssueType, ExpressionNodeType, JavaTypeType, LocalVariableType, ResolvedTypeType, ScopeType, SemanticAnalysisType, SemanticIndexType, SemanticOptionsType, SemanticResolutionType, TemplateAttributeType, TemplateModelType, TypePropertyType, TypeRefType } from "@exportTypes";

const CONTEXT_ROOTS: ReadonlySet<string> = new Set([`param`, `session`, `application`, `request`, `response`, `servletContext`, `execInfo`, `root`, `this`]);
const ITERABLE_TYPES: ReadonlySet<string> = new Set([`List`, `ArrayList`, `LinkedList`, `Set`, `HashSet`, `LinkedHashSet`, `TreeSet`, `SortedSet`, `Collection`, `Iterable`, `Page`, `Slice`, `Stream`, `Queue`, `Deque`, `ArrayDeque`, `Streamable`, `Window`]);
const MAP_TYPES: ReadonlySet<string> = new Set([`Map`, `HashMap`, `LinkedHashMap`, `TreeMap`, `SortedMap`, `ConcurrentHashMap`]);
const OBJECT_METHODS: ReadonlySet<string> = new Set([`toString`, `equals`, `hashCode`, `getClass`, `compareTo`, `name`, `ordinal`, `values`, `valueOf`]);
const STAT_PROPERTIES: Readonly<Record<string, string>> = { "index": `Integer`, "count": `Integer`, "size": `Integer`, "current": `Object`, "even": `Boolean`, "odd": `Boolean`, "first": `Boolean`, "last": `Boolean` };
const FRAGMENT_SELECTOR_NAME_PATTERN = /^[\w$-]+$/;
const LINK_SKIP_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i;

// 1. Java 타입 문자열 -> TypeRef -----------------------------------------------------------
export const parseTypeRef = (typeName: string): TypeRefType => {
  const trimmed = typeName.trim().replace(/^static:/, ``);
  const array = /\[\s*\]$/.test(trimmed);
  const withoutArray = trimmed.replace(/(\[\s*\])+$/, ``).trim();
  const angle = withoutArray.indexOf(`<`);
  if (angle < 0) {
    return { "name": simpleTypeName(withoutArray), "args": [], "array": array };
  }
  const base = withoutArray.slice(0, angle);
  const inner = withoutArray.slice(angle + 1, withoutArray.lastIndexOf(`>`));
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === `<`) {
      depth++;
    }
    else if (inner[i] === `>`) {
      depth--;
    }
    else if (inner[i] === `,` && depth === 0) {
      args.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  args.push(inner.slice(start));
  return { "name": simpleTypeName(base), "args": args.map((arg) => parseTypeRef(arg.replace(/^\?\s*(?:extends|super)\s+/, ``))), "array": array };
};
export const formatTypeRef = (ref: TypeRefType | undefined): string => {
  if (!ref) {
    return `?`;
  }
  const generics = ref.args.length > 0 ? `<${ref.args.map(formatTypeRef).join(`, `)}>` : ``;
  return `${ref.name}${generics}${ref.array ? `[]` : ``}`;
};

// 2. TypeRef -> 해석된 타입 (워크스페이스 클래스면 closed) ------------------------------------------
export const resolveTypeRef = (ref: TypeRefType | undefined, index: SemanticIndexType): ResolvedTypeType => {
  if (!ref || ref.array || ref.name === `?`) {
    return { "ref": ref, "open": true };
  }
  if (ref.name === `IterationStatus` || ref.name === `MapEntry`) {
    return { "ref": ref, "open": false };
  }
  const found = index.resolveJavaType(ref.name);
  if (!found || found.type.kind === `interface` && found.type.methods.length === 0) {
    return { "ref": ref, "open": true };
  }
  return { "ref": ref, "open": false, "javaType": found.type, "fsPath": found.fsPath };
};
const resolveTypeName = (typeName: string | undefined, index: SemanticIndexType): ResolvedTypeType => (typeName ? resolveTypeRef(parseTypeRef(typeName), index) : { "open": true });

// 3. 반복 요소 타입 -------------------------------------------------------------------------
export const elementTypeOf = (resolved: ResolvedTypeType): TypeRefType | undefined => {
  const ref = resolved.ref;
  if (!ref) {
    return undefined;
  }
  if (ref.array) {
    return { ...ref, "array": false };
  }
  if (ITERABLE_TYPES.has(ref.name)) {
    return ref.args[0];
  }
  if (MAP_TYPES.has(ref.name)) {
    return { "name": `MapEntry`, "args": ref.args, "array": false };
  }
  return undefined;
};

// 4. 타입 프로퍼티 조회 (필드·getter·Lombok·record, 상속 포함) ---------------------------------------
const propertyEntries = (type: JavaTypeType, fsPath: string): TypePropertyType[] => {
  const entries: TypePropertyType[] = [];
  const seen = new Set<string>();
  const add = (entry: TypePropertyType): void => {
    const key = entry.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      entries.push(entry);
    }
  };
  for (const component of type.recordComponents) {
    add({ "name": component.name, "type": component.type, "fsPath": fsPath, "line": component.line, "offset": component.offset, "kind": `component` });
  }
  for (const method of type.methods) {
    const getter = /^(get|is)([A-Z]\w*)$/.exec(method.name);
    if (getter && method.params.length === 0 && method.returnType !== `void`) {
      const name = getter[2].charAt(0).toLowerCase() + getter[2].slice(1);
      add({ "name": name, "type": method.returnType, "fsPath": fsPath, "line": method.line, "offset": method.offset, "kind": `getter` });
    }
  }
  for (const field of type.fields) {
    if (field.isStatic) {
      continue;
    }
    const lombok = type.lombokGetters || field.annotations.some((annotation) => annotation.name === `Getter`);
    if (lombok || field.isPublic || type.kind === `enum`) {
      const name = /^is[A-Z]/.test(field.name) && field.type === `boolean` ? field.name.charAt(2).toLowerCase() + field.name.slice(3) : field.name;
      add({ "name": name, "type": field.type, "fsPath": fsPath, "line": field.line, "offset": field.offset, "kind": `field` });
    }
  }
  if (type.kind === `enum`) {
    add({ "name": `name`, "type": `String`, "fsPath": fsPath, "line": type.line, "offset": type.offset, "kind": `method` });
    add({ "name": `ordinal`, "type": `Integer`, "fsPath": fsPath, "line": type.line, "offset": type.offset, "kind": `method` });
  }
  return entries;
};
export const listProperties = (resolved: ResolvedTypeType, index: SemanticIndexType): TypePropertyType[] => {
  if (resolved.ref?.name === `IterationStatus`) {
    return Object.entries(STAT_PROPERTIES).map(([name, type]) => ({ "name": name, "type": type, "fsPath": ``, "line": 0, "offset": 0, "kind": `getter` }));
  }
  if (resolved.ref?.name === `MapEntry`) {
    return [{ "name": `key`, "type": formatTypeRef(resolved.ref.args[0]), "fsPath": ``, "line": 0, "offset": 0, "kind": `getter` }, { "name": `value`, "type": formatTypeRef(resolved.ref.args[1]), "fsPath": ``, "line": 0, "offset": 0, "kind": `getter` }];
  }
  const entries: TypePropertyType[] = [];
  const seen = new Set<string>();
  const visited = new Set<string>();
  let current = resolved.javaType ? { "type": resolved.javaType, "fsPath": resolved.fsPath ?? `` } : undefined;
  while (current && !visited.has(current.type.name)) {
    visited.add(current.type.name);
    for (const entry of propertyEntries(current.type, current.fsPath)) {
      if (!seen.has(entry.name.toLowerCase())) {
        seen.add(entry.name.toLowerCase());
        entries.push(entry);
      }
    }
    current = current.type.extendsName ? index.resolveJavaType(current.type.extendsName) : undefined;
  }
  return entries;
};
export const listMethods = (resolved: ResolvedTypeType, index: SemanticIndexType): TypePropertyType[] => {
  const entries: TypePropertyType[] = [];
  const visited = new Set<string>();
  let current = resolved.javaType ? { "type": resolved.javaType, "fsPath": resolved.fsPath ?? `` } : undefined;
  while (current && !visited.has(current.type.name)) {
    visited.add(current.type.name);
    for (const method of current.type.methods) {
      (method.isPublic || current.type.kind === `interface`) && !method.isStatic && entries.push({ "name": method.name, "type": method.returnType, "fsPath": current.fsPath, "line": method.line, "offset": method.offset, "kind": `method` });
    }
    current = current.type.extendsName ? index.resolveJavaType(current.type.extendsName) : undefined;
  }
  return entries;
};
export const findProperty = (resolved: ResolvedTypeType, name: string, index: SemanticIndexType): TypePropertyType | undefined => {
  const lower = name.toLowerCase();
  return listProperties(resolved, index).find((entry) => entry.name.toLowerCase() === lower);
};
export const findMethod = (resolved: ResolvedTypeType, name: string, index: SemanticIndexType): TypePropertyType | undefined => listMethods(resolved, index).find((entry) => entry.name === name) ?? (/^(get|is)[A-Z]/.test(name) ? findProperty(resolved, name.replace(/^(get|is)/, ``), index) : undefined);

// 5. 루트 변수 해석 ------------------------------------------------------------------------
const resolveLocalType = (local: LocalVariableType, scope: ScopeType, index: SemanticIndexType, options: SemanticOptionsType, template: TemplateModelType, scopes: Map<number, ScopeType>, depth: number): ResolvedTypeType => {
  if (local.kind === `stat`) {
    return { "ref": { "name": `IterationStatus`, "args": [], "array": false }, "open": false };
  }
  if (local.kind === `fragment-param` || !local.expression || depth > 4) {
    return { "open": true };
  }
  const parentScope = scopes.get(template.elements[local.attribute.elementIndex]?.parent ?? -1) ?? { "locals": new Map(), "insideFragment": false };
  const ownerScope: ScopeType = { "locals": new Map([...parentScope.locals].filter(([name]) => name !== local.name)), "objectAttribute": scope.objectAttribute, "insideFragment": scope.insideFragment };
  const resolution = resolveChain(local.expression, local.expression.chains[0], ownerScope, index, options, template, scopes, depth + 1);
  const resolved = resolution?.segmentTypes.at(-1) ?? resolution?.rootType ?? { "open": true };
  if (local.kind === `each`) {
    const element = elementTypeOf(resolved);
    return element ? resolveTypeRef(element, index) : { "open": true };
  }
  return resolved;
};
export const resolveChain = (node: ExpressionNodeType, chain: ExpressionChainType | undefined, scope: ScopeType, index: SemanticIndexType, options: SemanticOptionsType, template: TemplateModelType, scopes: Map<number, ScopeType>, depth = 0): SemanticResolutionType | undefined => {
  if (!chain) {
    return undefined;
  }
  const resolution: SemanticResolutionType = { "node": node, "chain": chain, "rootKind": `other`, "rootType": { "open": true }, "segmentTypes": [], "segmentProperties": [] };
  const root = chain.root;
  if (node.kind === `selection` && scope.objectAttribute) {
    const objectNode = scope.objectAttribute.parsed.expressions[0];
    const objectResolution = objectNode ? resolveChain(objectNode, objectNode.chains[0], scope, index, options, template, scopes, depth + 1) : undefined;
    const objectType = objectResolution?.segmentTypes.at(-1) ?? objectResolution?.rootType ?? { "open": true };
    resolution.rootKind = `object`;
    if (root.kind === `identifier`) {
      const property = findProperty(objectType, root.name, index);
      resolution.rootType = objectType.open ? { "open": true } : property ? resolveTypeName(property.type, index) : { "open": true, "ref": undefined };
      resolution.segmentProperties.push(property);
      if (!objectType.open && !property && !OBJECT_METHODS.has(root.name)) {
        resolution.rootKind = `unknown`;
      }
    }
  }
  else if (node.kind === `selection`) {
    resolution.rootKind = `other`;
  }
  else if (root.kind === `identifier`) {
    const local = scope.locals.get(root.name);
    if (local) {
      resolution.rootKind = `local`;
      resolution.local = local;
      resolution.rootType = resolveLocalType(local, scope, index, options, template, scopes, depth);
    }
    else if (CONTEXT_ROOTS.has(root.name) || root.name.startsWith(`_`)) {
      resolution.rootKind = `context`;
    }
    else {
      const context = index.modelContextFor(options.templateName);
      const attributes = context.attributes.get(root.name);
      if (attributes && attributes.length > 0) {
        resolution.rootKind = `model`;
        resolution.modelAttributes = attributes;
        const typed = attributes.find((attribute) => attribute.typeName);
        resolution.rootType = resolveTypeName(typed?.typeName, index);
      }
      else {
        resolution.rootKind = context.mapped && !context.dynamic ? `unknown` : `other`;
      }
    }
  }
  else if (root.kind === `utility` || root.kind === `bean`) {
    resolution.rootKind = `utility`;
  }

  // 체인 세그먼트 타입 전파
  let current = resolution.rootType;
  for (const segment of chain.segments) {
    if (segment.kind === `index` && current.ref) {
      const next = MAP_TYPES.has(current.ref.name) ? current.ref.args[1] : elementTypeOf(current);
      current = next ? resolveTypeRef(next, index) : { "open": true };
      resolution.segmentProperties.push(undefined);
      resolution.segmentTypes.push(current);
      continue;
    }
    if (current.open) {
      resolution.segmentTypes.push({ "open": true });
      resolution.segmentProperties.push(undefined);
      continue;
    }
    if (segment.kind === `property`) {
      const property = findProperty(current, segment.name, index);
      current = property ? resolveTypeName(property.type, index) : { "open": true, "ref": undefined };
      resolution.segmentProperties.push(property);
      resolution.segmentTypes.push(property ? current : { "open": false, "ref": undefined });
      if (!property) {
        current = { "open": true };
      }
      continue;
    }
    if (segment.kind === `call`) {
      const method = findMethod(current, segment.name, index);
      const known = method !== undefined || OBJECT_METHODS.has(segment.name);
      current = method ? resolveTypeName(method.type, index) : { "open": true };
      resolution.segmentProperties.push(method);
      resolution.segmentTypes.push(known ? current : { "open": false, "ref": undefined });
      if (!known) {
        current = { "open": true };
      }
      continue;
    }
    current = { "open": true };
    resolution.segmentProperties.push(undefined);
    resolution.segmentTypes.push(current);
  }
  return resolution;
};

// 6. 시맨틱 분석 (모델 변수·프로퍼티·메시지·링크·프래그먼트) ------------------------------------------------
export const analyzeSemantics = (template: TemplateModelType, scopes: Map<number, ScopeType>, index: SemanticIndexType, options: SemanticOptionsType): SemanticAnalysisType => {
  const diagnostics: ExpressionIssueType[] = [];
  const resolutions = new Map<ExpressionChainType, SemanticResolutionType>();
  const emptyScope: ScopeType = { "locals": new Map(), "insideFragment": false };
  const push = (code: string, message: string, severity: ExpressionIssueType[`severity`], offset: number, length: number): void => {
    diagnostics.push({ "code": code, "message": message, "severity": severity, "offset": offset, "length": Math.max(1, length) });
  };

  const analyzeNode = (node: ExpressionNodeType, scope: ScopeType, attribute?: TemplateAttributeType): void => {
    // 변수·선택 체인
    for (const chain of node.chains) {
      const chainScope = attribute && attribute.name === `each` && chain === node.chains[0] && node === attribute.parsed.eachIterable ? withoutEachLocals(scope, attribute) : scope;
      const resolution = resolveChain(node, chain, chainScope, index, options, template, scopes);
      if (!resolution) {
        continue;
      }
      resolutions.set(chain, resolution);
      if (!options.modelValidation) {
        continue;
      }
      if (node.kind === `selection` && !scope.objectAttribute && !scope.insideFragment) {
        push(`thymeleaf-selection-without-object`, `Selection expression *{...} has no enclosing th:object.`, `warning`, node.offset, node.length);
      }
      const optional = node.kind !== `selection` && (chain.guarded === true || chain.segments[0]?.safe === true);
      if (resolution.rootKind === `unknown` && !optional) {
        const target = node.kind === `selection` ? `property '${chain.root.name}' of the th:object` : `model attribute '${chain.root.name}'`;
        push(node.kind === `selection` ? `thymeleaf-unknown-property` : `thymeleaf-unknown-model-attribute`, `Unknown ${target}. No controller mapped to this template adds it.`, `warning`, chain.root.offset, chain.root.length);
      }
      for (const [position, segment] of chain.segments.entries()) {
        const segmentType = resolution.segmentTypes[position];
        if (segmentType && !segmentType.open && segmentType.ref === undefined) {
          const ownerType = position === 0 ? resolution.rootType : resolution.segmentTypes[position - 1];
          const what = segment.kind === `call` ? `Method '${segment.name}()'` : `Property '${segment.name}'`;
          push(`thymeleaf-unknown-property`, `${what} does not exist on ${formatTypeRef(ownerType?.ref)}.`, `warning`, segment.offset, segment.length);
        }
      }
    }

    // 메시지 키·인자
    if (node.kind === `message` && node.key && !node.key.dynamic && options.messageValidation && index.hasMessages()) {
      const entries = index.findMessages(node.key.value);
      if (entries.length === 0) {
        push(`thymeleaf-unknown-message-key`, `Message key '${node.key.value}' was not found in the indexed message bundles.`, `warning`, node.key.offset, node.key.length);
      }
      else {
        const placeholders = Math.max(...entries.map((entry) => entry.placeholders));
        placeholders > node.args.length && push(`thymeleaf-message-arity`, `Message '${node.key.value}' expects ${placeholders} argument(s) but ${node.args.length} were given.`, `information`, node.offset, node.length);
      }
    }

    // 링크 존재
    if (node.kind === `link` && node.path && !node.path.dynamic && options.linkValidation && index.hasLinks()) {
      const path = node.path.value;
      if (path.startsWith(`/`) && !LINK_SKIP_PATTERN.test(path) && !index.linkExists(path)) {
        push(`thymeleaf-unknown-link`, `No controller mapping or static resource matches '${path}'.`, `information`, node.path.offset, node.path.length);
      }
    }

    // 프래그먼트 존재·인자 수
    if (node.kind === `fragment` && node.selector && !node.selector.dynamic && node.template && !node.template.dynamic) {
      const selector = node.selector.value.trim();
      const catalog = node.template.value === `` || node.template.value === `this` ? { "fragments": template.fragments, "tagNames": template.tagNames, "ids": template.ids, "refs": template.refs } : index.fragmentCatalog(node.template.value);
      if (catalog && FRAGMENT_SELECTOR_NAME_PATTERN.test(selector)) {
        const definition = catalog.fragments.find((fragment) => fragment.name === selector);
        if (!definition && !catalog.tagNames.has(selector.toLowerCase()) && !catalog.refs.has(selector)) {
          push(`thymeleaf-unknown-fragment`, `Fragment '${selector}' was not found in template '${node.template.value || `this`}'.`, `warning`, node.selector.offset, node.selector.length);
        }
        else if (definition && node.args.length > 0) {
          const named = node.args.filter((arg) => arg.name !== ``);

          // 시그니처 없는 프래그먼트 이름 인자
          if (named.length > 0 && definition.params.length === 0) {
            named.length !== node.args.length && push(`thymeleaf-fragment-arity`, `Fragment '${selector}' declares no parameters. Pass values by name only (name=value).`, `warning`, node.offset, node.length);
          }
          else if (named.length > 0) {
            for (const arg of named) {
              definition.params.includes(arg.name) || push(`thymeleaf-fragment-arity`, `Fragment '${selector}' has no parameter '${arg.name}'. Parameters: ${definition.params.join(`, `) || `(none)`}.`, `warning`, arg.offset, arg.length);
            }
          }
          else if (node.args.length !== definition.params.length) {
            push(`thymeleaf-fragment-arity`, `Fragment '${selector}' expects ${definition.params.length} argument(s) but ${node.args.length} were given.`, `warning`, node.offset, node.length);
          }
        }
      }
    }
  };

  for (const attribute of template.attributes) {
    if (!attribute.hasValue || attribute.parsed.errors.length > 0) {
      continue;
    }
    const scope = scopes.get(attribute.elementIndex) ?? emptyScope;
    for (const node of attribute.parsed.expressions) {
      analyzeNode(node, scope, attribute);
    }
  }
  for (const inline of template.inlines) {
    if (!inline.closed || inline.parsed.errors.length > 0) {
      continue;
    }
    const scope = scopes.get(inline.elementIndex) ?? emptyScope;
    for (const node of inline.parsed.expressions) {
      analyzeNode(node, scope);
    }
  }
  return { "diagnostics": diagnostics, "resolutions": resolutions };
};

// 7. th:each 자기 자신의 지역변수 제외 스코프 ----------------------------------------------------------
const withoutEachLocals = (scope: ScopeType, attribute: TemplateAttributeType): ScopeType => ({
  "locals": new Map([...scope.locals].filter(([, local]) => local.attribute !== attribute)),
  "objectAttribute": scope.objectAttribute,
  "insideFragment": scope.insideFragment,
});
