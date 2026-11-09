// models/SemanticModel.ts

import { simpleTypeName } from "@models/JavaModel";
import type { ExpressionChainType, ExpressionIssueType, ExpressionNodeType, JavaTypeType, LocalVariableType, ResolvedTypeType, ScopeType, SemanticAnalysisType, SemanticIndexType, SemanticOptionsType, SemanticResolutionType, TemplateAttributeType, TemplateModelType, TypePropertyType, TypeRefType } from "@exportTypes";

const CONTEXT_ROOTS: ReadonlySet<string> = new Set([`param`, `session`, `application`, `request`, `response`, `servletContext`, `execInfo`, `root`, `this`, `springRequestContext`, `springMacroRequestContext`, `thymeleafRequestContext`]);
const ITERABLE_TYPES: ReadonlySet<string> = new Set([`List`, `ArrayList`, `LinkedList`, `Set`, `HashSet`, `LinkedHashSet`, `TreeSet`, `SortedSet`, `Collection`, `Iterable`, `Page`, `Slice`, `Stream`, `Queue`, `Deque`, `ArrayDeque`, `Streamable`, `Window`]);
const MAP_TYPES: ReadonlySet<string> = new Set([`Map`, `HashMap`, `LinkedHashMap`, `TreeMap`, `SortedMap`, `ConcurrentHashMap`]);
const OBJECT_METHODS: ReadonlySet<string> = new Set([`toString`, `equals`, `hashCode`, `getClass`, `compareTo`, `name`, `ordinal`, `values`, `valueOf`]);
const STAT_PROPERTIES: Readonly<Record<string, string>> = { "index": `Integer`, "count": `Integer`, "size": `Integer`, "current": `Object`, "even": `Boolean`, "odd": `Boolean`, "first": `Boolean`, "last": `Boolean` };
const FRAGMENT_SELECTOR_NAME_PATTERN = /^[\w$-]+$/;
const LINK_SKIP_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i;
// Spring Boot·Security·WebJars 가 컨트롤러 없이 제공하는 경로
const FRAMEWORK_LINK_PATTERN = /^\/(?:login|logout|error|webjars|actuator|swagger-ui|swagger-ui\.html|v3\/api-docs|h2-console|oauth2|saml2)(?:[/?#]|$)/;
const MAX_RESOLVE_DEPTH = 8;
const MAX_LINEAGE_TYPES = 32;
const propertyCache = new WeakMap<JavaTypeType, TypePropertyType[]>();

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
  const partial = found.ambiguous === true || !collectLineage(found.type, found.fsPath, index).complete;
  return { "ref": ref, "open": false, "javaType": found.type, "fsPath": found.fsPath, "partial": partial };
};

// 2-1. 타입 계보 (자신 -> 상위 클래스 -> 인터페이스, 너비 우선)
// 구체 타입은 상위 클래스 체인이 워크스페이스 밖이면 complete=false (인터페이스 멤버는 직접 구현하므로 무관)
// 루트가 인터페이스면 상위 인터페이스 중 하나라도 워크스페이스 밖이면 complete=false
const collectLineage = (type: JavaTypeType, fsPath: string, index: SemanticIndexType): { types: { type: JavaTypeType; fsPath: string }[]; complete: boolean } => {
  const types: { type: JavaTypeType; fsPath: string }[] = [];
  const visited = new Set<string>();
  const queue = [{ "type": type, "fsPath": fsPath }];
  const rootIsInterface = type.kind === `interface`;
  let complete = true;
  while (queue.length > 0) {
    const current = queue.shift() as { type: JavaTypeType; fsPath: string };
    if (visited.has(current.type.qualifiedName) || visited.size > MAX_LINEAGE_TYPES) {
      continue;
    }
    visited.add(current.type.qualifiedName);
    types.push(current);
    const isInterface = current.type.kind === `interface`;
    const extendsName = current.type.extendsName !== `Object` ? current.type.extendsName : undefined;
    const superclass = isInterface ? undefined : extendsName;
    const interfaces = [...(isInterface && extendsName ? [extendsName] : []), ...current.type.implementsNames];
    for (const parentName of [...(superclass ? [superclass] : []), ...interfaces]) {
      const parent = index.resolveJavaType(parentName);
      if (parent) {
        queue.push({ "type": parent.type, "fsPath": parent.fsPath });
      }
      else if (parentName === superclass || rootIsInterface) {
        complete = false;
      }
    }
  }
  return { "types": types, "complete": complete };
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
  // 타입 객체는 재파싱 시 교체되므로 WeakMap 캐시가 자동 무효화됨
  const cached = propertyCache.get(type);
  if (cached) {
    return cached;
  }
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
  propertyCache.set(type, entries);
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
  const lineage = resolved.javaType ? collectLineage(resolved.javaType, resolved.fsPath ?? ``, index).types : [];
  for (const current of lineage) {
    for (const entry of propertyEntries(current.type, current.fsPath)) {
      if (!seen.has(entry.name.toLowerCase())) {
        seen.add(entry.name.toLowerCase());
        entries.push(entry);
      }
    }
  }
  return entries;
};
export const listMethods = (resolved: ResolvedTypeType, index: SemanticIndexType): TypePropertyType[] => {
  const entries: TypePropertyType[] = [];
  const seen = new Set<string>();
  const add = (entry: TypePropertyType): void => {
    if (!seen.has(entry.name)) {
      seen.add(entry.name);
      entries.push(entry);
    }
  };
  const lineage = resolved.javaType ? collectLineage(resolved.javaType, resolved.fsPath ?? ``, index).types : [];
  for (const current of lineage) {
    // record 컴포넌트는 같은 이름의 public 접근자 메서드 (guide.sections())
    for (const component of current.type.recordComponents) {
      add({ "name": component.name, "type": component.type, "fsPath": current.fsPath, "line": component.line, "offset": component.offset, "kind": `method` });
    }
    for (const method of current.type.methods) {
      (method.isPublic || current.type.kind === `interface`) && !method.isStatic && add({ "name": method.name, "type": method.returnType, "fsPath": current.fsPath, "line": method.line, "offset": method.offset, "kind": `method` });
    }
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
  const locals = new Map([...parentScope.locals].filter(([name]) => name !== local.name));

  // th:with 는 같은 요소의 th:each 변수와 앞선 할당을 참조 가능 (자신과 이후 할당은 제외)
  if (local.kind === `with`) {
    const elementScope = scopes.get(local.attribute.elementIndex);
    const assignments = local.attribute.parsed.assignments;
    const ownIndex = assignments.findIndex((assignment) => assignment.expression === local.expression);
    for (const [name, candidate] of elementScope?.locals ?? []) {
      candidate.attribute !== local.attribute && locals.set(name, candidate);
    }
    for (const assignment of assignments.slice(0, Math.max(0, ownIndex))) {
      locals.set(assignment.name, { "name": assignment.name, "kind": `with`, "attribute": local.attribute, "expression": assignment.expression });
    }
    locals.delete(local.name);
  }
  const ownerScope: ScopeType = { "locals": locals, "objectAttribute": scope.objectAttribute, "insideFragment": scope.insideFragment, "fragmentName": scope.fragmentName };
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
  if (depth > MAX_RESOLVE_DEPTH) {
    return resolution;
  }
  const root = chain.root;

  // th:object 자신의 값은 바깥 요소의 th:object 기준으로 해석 (자기 참조 무한 재귀 방지)
  let objectAttribute = scope.objectAttribute;
  if (objectAttribute?.parsed.expressions.includes(node)) {
    objectAttribute = scopes.get(template.elements[objectAttribute.elementIndex]?.parent ?? -1)?.objectAttribute;
  }
  if (node.kind === `selection` && objectAttribute) {
    const objectNode = objectAttribute.parsed.expressions[0];
    const objectScope = scopes.get(objectAttribute.elementIndex) ?? scope;
    const objectResolution = objectNode ? resolveChain(objectNode, objectNode.chains[0], objectScope, index, options, template, scopes, depth + 1) : undefined;
    const objectType = objectResolution?.segmentTypes.at(-1) ?? objectResolution?.rootType ?? { "open": true };
    resolution.rootKind = `object`;
    if (root.kind === `identifier`) {
      const property = findProperty(objectType, root.name, index);
      resolution.rootType = objectType.open ? { "open": true } : property ? resolveTypeName(property.type, index) : { "open": true, "ref": undefined };
      resolution.segmentProperties.push(property);
      if (!objectType.open && !objectType.partial && !property && !OBJECT_METHODS.has(root.name)) {
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

        // 같은 이름을 여러 핸들러가 다른 타입이나 추론 불가 타입으로 넣으면 타입 미확정 (open)
        const typeNames = new Set(attributes.map((attribute) => (attribute.typeName ? formatTypeRef(parseTypeRef(attribute.typeName)) : ``)));
        const typed = attributes.find((attribute) => attribute.typeName);
        resolution.rootType = typeNames.size === 1 ? resolveTypeName(typed?.typeName, index) : { "open": true };
      }
      else {
        // th:fragment 안에서 호출 지점이 name=value 로 넘긴 이름은 프래그먼트 지역 변수
        const passedByCaller = scope.fragmentName !== undefined && index.fragmentArgNames?.(options.templateName, scope.fragmentName)?.has(root.name) === true;
        resolution.rootKind = context.mapped && !context.dynamic && !passedByCaller ? `unknown` : `other`;
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

    // partial 소유 타입의 미발견 멤버는 오류 대신 open 으로 전파
    const ownerPartial = current.partial === true;
    if (segment.kind === `property`) {
      const property = findProperty(current, segment.name, index);
      current = property ? resolveTypeName(property.type, index) : { "open": true, "ref": undefined };
      resolution.segmentProperties.push(property);
      resolution.segmentTypes.push(property ? current : ownerPartial ? { "open": true } : { "open": false, "ref": undefined });
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
      resolution.segmentTypes.push(known ? current : ownerPartial ? { "open": true } : { "open": false, "ref": undefined });
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
    // 선택 표현식 객체 존재 (노드당 1회, th:object 자신의 값은 바깥 객체 기준)
    const objectAttribute = attribute !== undefined && scope.objectAttribute === attribute ? scopes.get(template.elements[attribute.elementIndex]?.parent ?? -1)?.objectAttribute : scope.objectAttribute;
    if (options.modelValidation && node.kind === `selection` && node.chains.length > 0 && !objectAttribute && !scope.insideFragment) {
      push(`thymeleaf-selection-without-object`, `Selection expression *{...} has no enclosing th:object.`, `warning`, node.offset, node.length);
    }

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
      if (path.startsWith(`/`) && !LINK_SKIP_PATTERN.test(path) && !FRAMEWORK_LINK_PATTERN.test(path) && !index.linkExists(path)) {
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
        else {
          // 인자 규칙 (Thymeleaf 3 FragmentSignatureUtils.processParameters 기준)
          // 1) 이름·위치 인자 혼합은 할당 시퀀스와 표현식 시퀀스 어느 쪽으로도 해석되지 않음
          // 2) 이름 인자는 시그니처 파라미터를 모두 포함해야 하고, 추가 이름은 프래그먼트 지역 변수로 허용
          // 3) 위치 인자는 시그니처 파라미터 수와 정확히 일치, 시그니처 없는 프래그먼트에는 사용 불가
          // 4) 파라미터를 선언한 시그니처는 인자 없이 선택 불가
          // th:ref·태그명 선택은 대상 요소의 th:fragment 여부를 알 수 없어 시그니처 검사 생략
          const named = node.args.filter((arg) => arg.name !== ``);
          const positionalCount = node.args.length - named.length;
          const signature = definition ? `${definition.name}(${definition.params.join(`, `)})` : ``;
          if (named.length > 0 && positionalCount > 0) {
            push(`thymeleaf-fragment-arity`, `Fragment '${selector}' mixes named and positional arguments. Pass all values by name (name=value) or all by position.`, `warning`, node.offset, node.length);
          }
          else if (named.length > 0) {
            const passedNames = new Set<string>();
            for (const arg of named) {
              passedNames.has(arg.name) && push(`thymeleaf-fragment-arity`, `Fragment argument '${arg.name}' is passed more than once. The last value wins.`, `warning`, arg.offset, arg.length);
              passedNames.add(arg.name);
            }
            const missing = (definition?.params ?? []).filter((param) => !passedNames.has(param));
            missing.length > 0 && push(`thymeleaf-fragment-arity`, `Fragment '${selector}' requires ${missing.map((param) => `'${param}'`).join(`, `)} when arguments are passed by name. Signature: ${signature}.`, `warning`, node.offset, node.length);
          }
          else if (positionalCount > 0 && definition && definition.params.length === 0) {
            push(`thymeleaf-fragment-arity`, `Fragment '${selector}' declares no parameters. Pass values by name only (name=value).`, `warning`, node.offset, node.length);
          }
          else if (positionalCount > 0 && definition && positionalCount !== definition.params.length) {
            push(`thymeleaf-fragment-arity`, `Fragment '${selector}' expects ${definition.params.length} argument(s) but ${positionalCount} were given. Signature: ${signature}.`, `warning`, node.offset, node.length);
          }
          else if (node.args.length === 0 && definition && definition.params.length > 0) {
            push(`thymeleaf-fragment-arity`, `Fragment '${selector}' declares parameters but none were given. Signature: ${signature}.`, `warning`, node.offset, node.length);
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
  "fragmentName": scope.fragmentName,
});
