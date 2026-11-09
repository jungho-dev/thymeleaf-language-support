// models/JavaModel.ts

import { buildLineStarts, offsetToPosition } from "@models/ThymeleafModel";
import type { JavaAnnotationType, JavaFieldType, JavaFileType, JavaInferenceContextType, JavaMethodType, JavaParamType, JavaTypeType, JavaViewNameType, ModelAttributeSourceType, ModelAttributeType } from "@exportTypes";

const PACKAGE_PATTERN = /^\s*package\s+([\w.]+)\s*;/m;
const IMPORT_PATTERN = /^\s*import\s+(?:static\s+)?([\w.*]+)\s*;/gm;
const TYPE_DECL_PATTERN = /(?<![@\w.])(class|interface|enum|record)\s+([A-Za-z_]\w*)\s*(?:<[^{(]*?>)?\s*(?:\(([^)]*)\))?\s*(?:extends\s+([^{]+?))?\s*(?:implements\s+([^{]+?))?\s*(?:permits\s+[^{]+?)?\s*\{/g;
const ANNOTATION_PATTERN = /@([\w.]+)(?:\s*\(((?:[^()]|\([^()]*\))*)\))?/g;
const METHOD_PATTERN = /((?:@[\w.]+(?:\s*\((?:[^()]|\([^()]*\))*\))?\s*)*)((?:(?:public|protected|private|static|final|abstract|synchronized|default|native|strictfp)\s+)*)(?:<[^>]*>\s*)?([\w.$]+(?:\s*<[^;{}()]*?>)?(?:\s*\[\s*\])*)\s+([A-Za-z_$][\w$]*)\s*\(((?:[^()]|\([^()]*\))*)\)\s*(?:throws\s+[\w.,\s]+?)?\s*(\{|;)/g;
const FIELD_PATTERN = /((?:@[\w.]+(?:\s*\((?:[^()]|\([^()]*\))*\))?\s*)*)((?:(?:public|protected|private|static|final|transient|volatile)\s+)*)([\w.$]+(?:\s*<[^;{}()=]*?>)?(?:\s*\[\s*\])*)\s+([A-Za-z_$][\w$]*)\s*(?:=[^;]*)?;/g;
const MODEL_CALL_PATTERN = /\b([A-Za-z_$][\w$]*)(?:\s*\.\s*getModel(?:Map)?\s*\(\s*\))?\s*\.\s*(addAttribute|addObject|addFlashAttribute|put|setAttribute|addAllAttributes|mergeAttributes|putAll|addAllObjects)\s*\(/g;
const RETURN_PATTERN = /\breturn\b([^;]*);/g;
const STRING_LITERAL_PATTERN = /"((?:[^"\\]|\\.)*)"/g;
const NEW_MAV_PATTERN = /new\s+ModelAndView\s*\(\s*"([^"]*)"(?:\s*,\s*"([^"]*)"\s*,)?/g;
const SET_VIEW_PATTERN = /\.\s*setViewName\s*\(\s*"([^"]*)"/g;
const CALL_NAME_PATTERN = /([A-Za-z_$][\w$]*)\s*\(/g;
const STRING_CONSTANT_PATTERN = /\b(?:static\s+final|final\s+static)\s+String\s+([A-Za-z_$][\w$]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g;
const CALL_RECEIVER_PATTERN = /([A-Za-z_$][\w$]*)\s*\.\s*$/;
const MODEL_LOCAL_PATTERN = /\b(?:Model|ModelMap|ExtendedModelMap|ModelAndView)\s+([a-z_$][\w$]*)\s*=/g;
const SERVLET_FILTER_IMPORT_PATTERN = /^(?:javax|jakarta)\.servlet\.(?:Filter|\*)$/;
const LOCAL_DECL_PATTERN = /(?<![\w.])((?:[A-Z][\w.]*|var)(?:\s*<[^;=()]*?>)?(?:\s*\[\s*\])*)\s+([a-z_$][\w$]*)\s*(=|;|:)/g;
const KEYWORD_SET: ReadonlySet<string> = new Set([`return`, `new`, `throw`, `else`, `case`, `import`, `package`, `public`, `private`, `protected`, `static`, `final`, `abstract`, `if`, `for`, `while`, `switch`, `try`, `catch`, `finally`, `do`, `synchronized`, `instanceof`]);
const MAPPING_ANNOTATIONS: Readonly<Record<string, string[]>> = { "RequestMapping": [], "GetMapping": [`GET`], "PostMapping": [`POST`], "PutMapping": [`PUT`], "DeleteMapping": [`DELETE`], "PatchMapping": [`PATCH`] };
const MODEL_DELEGATE_TYPES: ReadonlySet<string> = new Set([`Model`, `ModelMap`, `ExtendedModelMap`, `ModelAndView`, `Map`]);
const NEUTRAL_RECEIVERS: ReadonlySet<string> = new Set([`Objects`, `ObjectUtils`, `StringUtils`, `CollectionUtils`, `Assert`, `Optional`, `String`, `System`, `log`, `logger`, `LOG`, `LOGGER`]);
const NON_CALL_WORDS: ReadonlySet<string> = new Set([`if`, `for`, `while`, `switch`, `catch`, `synchronized`, `return`, `throw`, `assert`]);
const INTERCEPTOR_TYPES: ReadonlySet<string> = new Set([`HandlerInterceptor`, `AsyncHandlerInterceptor`, `WebRequestInterceptor`, `AsyncWebRequestInterceptor`, `HandlerInterceptorAdapter`]);
// 서블릿 필터도 request.setAttribute 로 모든 템플릿에 값을 노출하므로 전역 모델 소스 (단순명 Filter 는 servlet import 가 있을 때만)
const SERVLET_FILTER_TYPES: ReadonlySet<string> = new Set([`OncePerRequestFilter`, `GenericFilterBean`, `HttpFilter`]);
const MODEL_RECEIVER_TYPES: ReadonlySet<string> = new Set([`Model`, `ModelMap`, `ExtendedModelMap`, `ModelAndView`, `RedirectAttributes`, `RedirectAttributesModelMap`, `Map`, `HashMap`, `LinkedHashMap`, `HttpServletRequest`, `HttpSession`, `WebRequest`, `ServletRequest`]);
const SIMPLE_TYPES: ReadonlySet<string> = new Set([`String`, `int`, `long`, `short`, `byte`, `char`, `boolean`, `double`, `float`, `Integer`, `Long`, `Short`, `Byte`, `Character`, `Boolean`, `Double`, `Float`, `BigDecimal`, `BigInteger`, `LocalDate`, `LocalDateTime`, `LocalTime`, `Date`, `UUID`, `Object`, `Number`, `CharSequence`]);
const FRAMEWORK_PARAM_TYPES: ReadonlySet<string> = new Set([`Model`, `ModelMap`, `ModelAndView`, `HttpServletRequest`, `HttpServletResponse`, `HttpSession`, `Principal`, `Authentication`, `Locale`, `BindingResult`, `Errors`, `RedirectAttributes`, `Pageable`, `Sort`, `MultipartFile`, `WebRequest`, `NativeWebRequest`, `ServletRequest`, `ServletResponse`, `SessionStatus`, `TimeZone`, `ZoneId`, `InputStream`, `OutputStream`, `Reader`, `Writer`, `HttpMethod`, `HttpEntity`, `RequestEntity`, `UriComponentsBuilder`, `ServletUriComponentsBuilder`, `PushBuilder`, `CsrfToken`, `UserDetails`, `MultipartHttpServletRequest`, `HttpHeaders`, `Map`, `List`, `Set`, `Collection`, `Optional`, `Device`]);
const EXCLUDED_PARAM_ANNOTATIONS: ReadonlySet<string> = new Set([`RequestParam`, `PathVariable`, `RequestBody`, `RequestHeader`, `CookieValue`, `RequestPart`, `MatrixVariable`, `SessionAttribute`, `RequestAttribute`, `AuthenticationPrincipal`, `CurrentSecurityContext`, `Value`]);
const COLLECTION_FACTORY_PATTERN = /^(List|Arrays|Collections|Set|Map|Stream)\s*\.\s*(of|asList|emptyList|emptyMap|emptySet|singletonList|unmodifiableList)\b/;

// 1. 주석·문자열 마스킹 (오프셋 보존) ----------------------------------------------------------
const maskSource = (text: string): { masked: string; structural: string } => {
  const maskedParts: string[] = [];
  const structuralParts: string[] = [];
  const size = text.length;
  let copied = 0;
  let i = 0;

  // 구간은 앞에서부터 단조 증가 순서로만 공백화
  const blank = (from: number, to: number, both: boolean): void => {
    if (to <= from) {
      return;
    }
    const kept = text.slice(copied, from);
    const original = text.slice(from, to);
    const spaces = original.replace(/[^\r\n]/g, ` `);
    maskedParts.push(kept, both ? spaces : original);
    structuralParts.push(kept, spaces);
    copied = to;
  };
  while (i < size) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === `/` && next === `/`) {
      const end = text.indexOf(`\n`, i);
      const stop = end < 0 ? size : end;
      blank(i, stop, true);
      i = stop;
      continue;
    }
    if (ch === `/` && next === `*`) {
      const end = text.indexOf(`*/`, i + 2);
      const stop = end < 0 ? size : end + 2;
      blank(i, stop, true);
      i = stop;
      continue;
    }
    if (ch === `"` && text.startsWith(`"""`, i)) {
      const end = text.indexOf(`"""`, i + 3);
      const stop = end < 0 ? size : end + 3;
      blank(i + 3, Math.max(i + 3, stop - 3), false);
      i = stop;
      continue;
    }
    if (ch === `"` || ch === `'`) {
      let j = i + 1;
      while (j < size && text[j] !== ch && text[j] !== `\n`) {
        j += text[j] === `\\` ? 2 : 1;
      }
      const stop = Math.min(size, j + 1);
      blank(i + 1, Math.max(i + 1, stop - 1), false);
      i = stop;
      continue;
    }
    i++;
  }
  maskedParts.push(text.slice(copied));
  structuralParts.push(text.slice(copied));
  return { "masked": maskedParts.join(``), "structural": structuralParts.join(``) };
};

// 2. 선언 시작 경계 (괄호 밖의 ; { } 까지 역방향 탐색) ----------------------------------------------
const findDeclarationBoundary = (text: string, declStart: number, floor: number): number => {
  let depth = 0;
  for (let i = declStart - 1; i >= floor; i--) {
    const ch = text[i];
    if (ch === `)`) {
      depth++;
    }
    else if (ch === `(`) {
      depth = Math.max(0, depth - 1);
    }
    else if (depth === 0 && (ch === `;` || ch === `{` || ch === `}`)) {
      return i;
    }
  }
  return floor - 1;
};

// 2-1. 괄호 짝 탐색 -------------------------------------------------------------------------
const findMatching = (text: string, openIndex: number, open: string, close: string): number => {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === open) {
      depth++;
    }
    else if (text[i] === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
};

// 3. 최상위 쉼표 분리 (괄호·제네릭 보존) -----------------------------------------------------------
export const splitTopLevel = (text: string, separator = `,`): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let angle = 0;
  let start = 0;
  let quote = ``;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === `\\`) {
        i++;
      }
      else if (ch === quote) {
        quote = ``;
      }
      continue;
    }
    if (ch === `"` || ch === `'`) {
      quote = ch;
    }
    else if (ch === `(` || ch === `[` || ch === `{`) {
      depth++;
    }
    else if (ch === `)` || ch === `]` || ch === `}`) {
      depth--;
    }
    else if (ch === `<`) {
      angle++;
    }
    else if (ch === `>`) {
      angle = Math.max(0, angle - 1);
    }
    else if (ch === separator && depth === 0 && angle === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== ``);
};

// 4. 어노테이션 파싱 -------------------------------------------------------------------------
const parseAnnotations = (text: string): JavaAnnotationType[] => {
  const annotations: JavaAnnotationType[] = [];
  ANNOTATION_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(ANNOTATION_PATTERN)) {
    const name = match[1].split(`.`).at(-1) ?? match[1];
    annotations.push({ "name": name, "args": (match[2] ?? ``).trim() });
  }
  return annotations;
};
const annotationLiterals = (args: string, keys: string[]): string[] => {
  const literals: string[] = [];
  const named = new RegExp(`\\b(?:${keys.join(`|`)})\\s*=\\s*(\\{(?:"(?:[^"\\\\]|\\\\.)*"|[^}"])*\\}|"(?:[^"\\\\]|\\\\.)*")`, `g`);
  const namedMatches = [...args.matchAll(named)];
  const source = namedMatches.length > 0 ? namedMatches.map((match) => match[1]).join(`,`) : /^\s*(?:\{|")/.test(args) ? args : ``;
  for (const match of source.matchAll(/"([^"]*)"/g)) {
    literals.push(match[1]);
  }
  return literals;
};
const hasAnnotation = (annotations: JavaAnnotationType[], name: string): boolean => annotations.some((annotation) => annotation.name === name);
const findAnnotation = (annotations: JavaAnnotationType[], name: string): JavaAnnotationType | undefined => annotations.find((annotation) => annotation.name === name);
export const isModelSource = (type: JavaTypeType): boolean => type.isController || type.isControllerAdvice || type.isInterceptor;

// 5. 타입명 유틸 -----------------------------------------------------------------------------
export const simpleTypeName = (typeName: string): string => {
  const base = typeName.trim().replace(/<.*$/s, ``).replace(/\[\s*\]/g, ``).trim();
  return base.split(`.`).at(-1) ?? base;
};
export const lowerFirst = (name: string): string => (name.length > 1 && name[1] === name[1].toUpperCase() && /[A-Z]/.test(name[1]) ? name : name.charAt(0).toLowerCase() + name.slice(1));

// 6. 파라미터 목록 파싱 ---------------------------------------------------------------------
const parseParams = (text: string): JavaParamType[] => splitTopLevel(text).map((part): JavaParamType | undefined => {
  const annotations = parseAnnotations(part);
  const cleaned = part.replace(ANNOTATION_PATTERN, ` `).replace(/\bfinal\b/g, ` `).trim();
  const match = /^([\w.$]+(?:\s*<.*>)?(?:\s*\[\s*\])*)(?:\s*\.\.\.)?\s+([A-Za-z_$][\w$]*)$/s.exec(cleaned);
  return match ? { "name": match[2], "type": match[1].replace(/\s+/g, ``), "annotations": annotations } : undefined;
}).filter((param): param is JavaParamType => param !== undefined);

// 7. 멤버 텍스트 (중첩 타입·메서드 본문 공백화) ---------------------------------------------------
const blankBlocks = (text: string, from: number, to: number, ranges: [number, number][]): string => {
  const blankRanges = (source: string, targets: [number, number][]): string => {
    const parts: string[] = [];
    let cursor = 0;
    for (const [rangeStart, rangeEnd] of targets) {
      const start = Math.max(cursor, rangeStart);
      const stop = Math.min(source.length, rangeEnd);
      if (start >= stop) {
        continue;
      }
      parts.push(source.slice(cursor, start), source.slice(start, stop).replace(/[^\r\n]/g, ` `));
      cursor = stop;
    }
    parts.push(source.slice(cursor));
    return parts.join(``);
  };

  // 중첩 타입은 선언부까지 통째로 공백화
  const withoutNested = blankRanges(text.slice(from, to), ranges.map(([start, end]): [number, number] => [start - from, end - from]));

  // 메서드·초기화 블록은 중괄호를 남기고 내부만 공백화
  const blocks: [number, number][] = [];
  let depth = 0;
  let blockStart = -1;
  for (let i = 0; i < withoutNested.length; i++) {
    if (withoutNested[i] === `{`) {
      if (depth === 0) {
        blockStart = i;
      }
      depth++;
    }
    else if (withoutNested[i] === `}`) {
      depth--;
      if (depth === 0 && blockStart >= 0) {
        blocks.push([blockStart + 1, i]);
        blockStart = -1;
      }
    }
  }
  blockStart >= 0 && blocks.push([blockStart + 1, withoutNested.length]);
  return blankRanges(withoutNested, blocks);
};

// 8. Java 파일 파싱 --------------------------------------------------------------------------
export const parseJavaFile = (text: string, fsPath: string): JavaFileType => {
  const { masked, structural } = maskSource(text);
  const lineStarts = buildLineStarts(text);
  const packageName = PACKAGE_PATTERN.exec(masked)?.[1] ?? ``;
  const imports = [...masked.matchAll(IMPORT_PATTERN)].map((match) => match[1]);
  const servletFilterImported = imports.some((imported) => SERVLET_FILTER_IMPORT_PATTERN.test(imported));
  const types: JavaTypeType[] = [];
  const positionOf = (offset: number) => offsetToPosition(lineStarts, offset);

  const collectTypes = (from: number, to: number, outerName: string): void => {
    TYPE_DECL_PATTERN.lastIndex = from;
    let match = TYPE_DECL_PATTERN.exec(structural);
    while (match && match.index < to) {
      const bodyStart = match.index + match[0].length - 1;
      const bodyEnd = findMatching(structural, bodyStart, `{`, `}`);
      if (bodyEnd < 0) {
        break;
      }
      const declStart = match.index;
      const previousBoundary = findDeclarationBoundary(structural, declStart, from);
      const annotations = parseAnnotations(masked.slice(previousBoundary + 1, declStart));
      const kind = match[1] as JavaTypeType[`kind`];
      const name = match[2];
      const qualifiedName = outerName ? `${outerName}.${name}` : packageName ? `${packageName}.${name}` : name;

      // 인터페이스는 extends 로 여러 상위 인터페이스를 받음 (첫 번째는 extendsName, 나머지는 implementsNames)
      const extendsList = match[4] ? splitTopLevel(match[4]).map(simpleTypeName).filter((parent) => parent !== ``) : [];
      const extendsName = extendsList[0];
      const implementsNames = [...(kind === `interface` ? extendsList.slice(1) : []), ...(match[5] ? splitTopLevel(match[5]).map(simpleTypeName) : [])];

      // 중첩 타입 범위 수집
      const nestedRanges: [number, number][] = [];
      TYPE_DECL_PATTERN.lastIndex = bodyStart + 1;
      let nested = TYPE_DECL_PATTERN.exec(structural);
      while (nested && nested.index < bodyEnd) {
        const nestedBodyStart = nested.index + nested[0].length - 1;
        const nestedBodyEnd = findMatching(structural, nestedBodyStart, `{`, `}`);
        if (nestedBodyEnd < 0) {
          break;
        }
        const nestedBoundary = findDeclarationBoundary(structural, nested.index, bodyStart + 1);
        nestedRanges.push([nestedBoundary + 1, nestedBodyEnd + 1]);
        TYPE_DECL_PATTERN.lastIndex = nestedBodyEnd + 1;
        nested = TYPE_DECL_PATTERN.exec(structural);
      }

      const memberText = blankBlocks(structural, bodyStart + 1, bodyEnd, nestedRanges);
      const memberBase = bodyStart + 1;
      const fields: JavaFieldType[] = [];
      const methods: JavaMethodType[] = [];

      // 메서드
      METHOD_PATTERN.lastIndex = 0;
      for (const member of memberText.matchAll(METHOD_PATTERN)) {
        const returnType = member[3].replace(/\s+/g, ``);
        const methodName = member[4];
        if (KEYWORD_SET.has(returnType) || KEYWORD_SET.has(methodName) || methodName === name) {
          continue;
        }
        const annotationText = masked.slice(memberBase + member.index, memberBase + member.index + member[1].length);
        const modifiers = member[2];
        const signatureOffset = memberBase + member.index + member[1].length;
        const braceOffset = memberBase + member.index + member[0].length - 1;
        const hasBody = member[6] === `{`;
        const methodBodyEnd = hasBody ? findMatching(structural, braceOffset, `{`, `}`) : -1;
        const paramsOpen = signatureOffset + member[0].slice(member[1].length).indexOf(`(`);
        methods.push({
          "name": methodName,
          "returnType": returnType,
          "params": parseParams(masked.slice(paramsOpen + 1, paramsOpen + 1 + member[5].length)),
          "annotations": parseAnnotations(annotationText),
          "isPublic": /\bpublic\b/.test(modifiers) || kind === `interface`,
          "isStatic": /\bstatic\b/.test(modifiers),
          "line": positionOf(signatureOffset).line,
          "offset": signatureOffset,
          "bodyStart": hasBody ? braceOffset + 1 : -1,
          "bodyEnd": methodBodyEnd,
        });
      }

      // 필드
      FIELD_PATTERN.lastIndex = 0;
      for (const member of memberText.matchAll(FIELD_PATTERN)) {
        const fieldType = member[3].replace(/\s+/g, ``);
        if (KEYWORD_SET.has(fieldType)) {
          continue;
        }
        const annotationText = masked.slice(memberBase + member.index, memberBase + member.index + member[1].length);
        const offset = memberBase + member.index + member[1].length;
        fields.push({ "name": member[4], "type": fieldType, "annotations": parseAnnotations(annotationText), "isPublic": /\bpublic\b/.test(member[2]), "isStatic": /\bstatic\b/.test(member[2]), "line": positionOf(offset).line, "offset": offset });
      }

      // 레코드 컴포넌트·enum 상수
      const recordComponents: JavaFieldType[] = kind === `record` && match[3] ? parseParams(match[3]).map((param) => ({ "name": param.name, "type": param.type, "annotations": param.annotations, "isPublic": true, "isStatic": false, "line": positionOf(declStart).line, "offset": declStart })) : [];
      const enumConstants: string[] = [];
      if (kind === `enum`) {
        const constantEnd = memberText.indexOf(`;`);
        const constantText = memberText.slice(0, constantEnd < 0 ? memberText.length : constantEnd);
        for (const part of splitTopLevel(constantText)) {
          const constant = /^(?:@\w+\s*)*([A-Z_][\w]*)/.exec(part);
          constant && enumConstants.push(constant[1]);
        }
      }

      const typeModel: JavaTypeType = {
        "name": name,
        "qualifiedName": qualifiedName,
        "kind": kind,
        "annotations": annotations,
        "extendsName": extendsName,
        "implementsNames": implementsNames,
        "fields": fields,
        "methods": methods,
        "recordComponents": recordComponents,
        "enumConstants": enumConstants,
        "lombokGetters": [`Data`, `Getter`, `Value`].some((lombok) => hasAnnotation(annotations, lombok)),
        "line": positionOf(declStart).line,
        "offset": declStart,
        "bodyStart": bodyStart,
        "bodyEnd": bodyEnd,
        "isController": hasAnnotation(annotations, `Controller`),
        "isRestController": hasAnnotation(annotations, `RestController`),
        "isControllerAdvice": hasAnnotation(annotations, `ControllerAdvice`) || hasAnnotation(annotations, `RestControllerAdvice`),
        "isInterceptor": [...implementsNames, extendsName ?? ``].some((parent) => INTERCEPTOR_TYPES.has(parent) || SERVLET_FILTER_TYPES.has(parent) || (parent === `Filter` && servletFilterImported)),
        "classPaths": annotationLiterals(findAnnotation(annotations, `RequestMapping`)?.args ?? ``, [`value`, `path`]),
        "sessionAttributes": annotationLiterals(findAnnotation(annotations, `SessionAttributes`)?.args ?? ``, [`value`, `names`]),
        "handlers": [],
        "modelAttributeMethods": [],
        "classAttributes": [],
        "flashAttributes": [],
        "dynamicModel": false,
      };
      (isModelSource(typeModel) || typeModel.isRestController) && analyzeController(typeModel, masked, fsPath, lineStarts);
      types.push(typeModel);

      collectTypes(bodyStart + 1, bodyEnd, qualifiedName);
      TYPE_DECL_PATTERN.lastIndex = bodyEnd + 1;
      match = TYPE_DECL_PATTERN.exec(structural);
    }
  };
  collectTypes(0, structural.length, ``);
  return { "fsPath": fsPath, "packageName": packageName, "imports": imports, "types": types };
};

// 9. 컨트롤러 분석 (핸들러·뷰명·모델 속성) --------------------------------------------------------
const analyzeController = (type: JavaTypeType, masked: string, fsPath: string, lineStarts: number[]): void => {
  const positionOf = (offset: number) => offsetToPosition(lineStarts, offset);
  const fieldTypes = new Map(type.fields.map((field) => [field.name, field.type]));
  const methodAt = (offset: number): JavaMethodType | undefined => type.methods.find((method) => method.bodyStart >= 0 && offset >= method.bodyStart && offset <= method.bodyEnd);
  const buildAttribute = (name: string, offset: number, length: number, source: ModelAttributeSourceType, methodName: string, valueExpr?: string): ModelAttributeType => {
    const position = positionOf(offset);
    return { "name": name, "valueExpr": valueExpr, "fsPath": fsPath, "line": position.line, "column": position.column, "length": length, "offset": offset, "source": source, "methodName": methodName };
  };

  // 9-1. 모델 조작 호출 수집
  const body = masked.slice(type.bodyStart, type.bodyEnd + 1);
  const attributesByMethod = new Map<string, ModelAttributeType[]>();
  const dynamicMethods = new Set<string>();
  const isServletFilter = type.isInterceptor && ![...type.implementsNames, type.extendsName ?? ``].some((parent) => INTERCEPTOR_TYPES.has(parent));
  const stringConstants = new Map([...body.matchAll(STRING_CONSTANT_PATTERN)].map((constant): [string, string] => [constant[1], constant[2]]));
  MODEL_CALL_PATTERN.lastIndex = 0;
  for (const call of body.matchAll(MODEL_CALL_PATTERN)) {
    const absolute = type.bodyStart + call.index;
    const owner = methodAt(absolute);
    const ownerName = owner?.name ?? ``;
    const receiver = call[1];
    const operation = call[2];
    const openParen = absolute + call[0].length - 1;
    const closeParen = findMatching(masked, openParen, `(`, `)`);
    if (closeParen < 0) {
      continue;
    }
    const args = splitTopLevel(masked.slice(openParen + 1, closeParen));
    const receiverType = owner ? simpleTypeName(owner.params.find((param) => param.name === receiver)?.type ?? fieldTypes.get(receiver) ?? ``) : ``;
    const receiverLooksLikeModel = MODEL_RECEIVER_TYPES.has(receiverType) || /model|mav|attr|redirect|request|session/i.test(receiver);
    if (operation === `put` && !receiverLooksLikeModel) {
      continue;
    }
    if (operation === `addAllAttributes` || operation === `mergeAttributes` || operation === `putAll` || operation === `addAllObjects`) {
      dynamicMethods.add(ownerName);
      continue;
    }
    let source: ModelAttributeSourceType = `addAttribute`;
    if (operation === `addFlashAttribute`) {
      source = `flash`;
    }
    else if (operation === `setAttribute`) {
      if (/session/i.test(receiver) || receiverType === `HttpSession`) {
        source = `session`;
      }
      else if (/request|req/i.test(receiver) || receiverType === `HttpServletRequest` || receiverType === `WebRequest`) {
        source = `request`;
      }
      else {
        continue;
      }
    }

    // 세션 속성 제외 (모델 미노출)
    if (source === `session`) {
      continue;
    }

    // 속성명: 문자열 리터럴 또는 같은 타입의 static final String 상수, 그 외는 이름을 알 수 없어 dynamic
    const nameArg = (args[0] ?? ``).trim();
    const literal = /^"((?:[^"\\]|\\.)*)"$/.exec(nameArg);
    const constantName = nameArg.startsWith(`${type.name}.`) ? nameArg.slice(type.name.length + 1) : nameArg;
    const attributeName = literal ? literal[1] : stringConstants.get(constantName);

    // 필터의 미해석 이름은 건너뜀 (전역 dynamic 으로 모든 템플릿 검사를 끄지 않음)
    if (attributeName === undefined) {
      isServletFilter || dynamicMethods.add(ownerName);
      continue;
    }
    const nameOffset = literal ? masked.indexOf(`"`, openParen) + 1 : masked.indexOf(nameArg, openParen);
    const attribute = buildAttribute(attributeName, nameOffset, literal ? attributeName.length : nameArg.length, source, ownerName, args[1]);
    if (source === `flash`) {
      type.flashAttributes.push(attribute);
    }
    else {
      type.classAttributes.push(attribute);
      const list = attributesByMethod.get(ownerName) ?? [];
      list.push(attribute);
      attributesByMethod.set(ownerName, list);
    }
  }

  // 9-2. 핸들러의 모델 위임 호출 (다른 객체·상위 클래스 메서드에 모델을 넘기면 그 핸들러만 dynamic)
  // 같은 클래스 메서드는 9-1 에서 classAttributes 로 수집됨, 클래스 전체(dynamicModel)로는 전파하지 않음
  const delegatingHandlers = new Set<string>();
  const ownMethodNames = new Set(type.methods.map((method) => method.name));
  for (const method of type.methods) {
    if (method.bodyStart < 0 || !method.annotations.some((annotation) => annotation.name in MAPPING_ANNOTATIONS)) {
      continue;
    }
    const methodBody = masked.slice(method.bodyStart, method.bodyEnd + 1);
    const modelParams = method.params.filter((param) => MODEL_DELEGATE_TYPES.has(simpleTypeName(param.type)) && !param.annotations.some((annotation) => EXCLUDED_PARAM_ANNOTATIONS.has(annotation.name)));
    const modelNames = new Set(modelParams.map((param) => param.name));
    for (const local of methodBody.matchAll(MODEL_LOCAL_PATTERN)) {
      modelNames.add(local[1]);
    }
    if (modelNames.size === 0) {
      continue;
    }
    for (const call of methodBody.matchAll(CALL_NAME_PATTERN)) {
      const callName = call[1];
      const receiver = CALL_RECEIVER_PATTERN.exec(methodBody.slice(Math.max(0, call.index - 120), call.index))?.[1];
      const sameClass = (receiver === undefined || receiver === `this`) && ownMethodNames.has(callName);
      if (NON_CALL_WORDS.has(callName) || sameClass || (receiver !== undefined && (modelNames.has(receiver) || NEUTRAL_RECEIVERS.has(receiver)))) {
        continue;
      }
      const openParen = call.index + call[0].length - 1;
      const closeParen = findMatching(methodBody, openParen, `(`, `)`);
      if (closeParen > openParen && splitTopLevel(methodBody.slice(openParen + 1, closeParen)).some((arg) => modelNames.has(arg.trim()))) {
        delegatingHandlers.add(method.name);
        break;
      }
    }
  }

  // 9-3. ModelAndView 생성자 속성 (new ModelAndView("view", map) 의 Map 내용은 알 수 없어 그 핸들러만 dynamic)
  NEW_MAV_PATTERN.lastIndex = 0;
  for (const mav of body.matchAll(NEW_MAV_PATTERN)) {
    const absolute = type.bodyStart + mav.index;
    const owner = methodAt(absolute)?.name ?? ``;
    if (!mav[2]) {
      const openParen = masked.indexOf(`(`, absolute);
      const closeParen = findMatching(masked, openParen, `(`, `)`);
      const mavArgs = closeParen > openParen ? splitTopLevel(masked.slice(openParen + 1, closeParen)) : [];
      mavArgs.length === 2 && !/^\s*HttpStatus/.test(mavArgs[1]) && delegatingHandlers.add(owner);
      continue;
    }
    const literalOffset = masked.indexOf(`"`, masked.indexOf(`,`, absolute)) + 1;
    const attribute = buildAttribute(mav[2], literalOffset, mav[2].length, `view`, owner);
    type.classAttributes.push(attribute);
    const list = attributesByMethod.get(owner) ?? [];
    list.push(attribute);
    attributesByMethod.set(owner, list);
  }

  // 9-4. 핸들러·@ModelAttribute 메서드
  for (const method of type.methods) {
    const mapping = method.annotations.find((annotation) => annotation.name in MAPPING_ANNOTATIONS);
    const modelAttributeAnnotation = findAnnotation(method.annotations, `ModelAttribute`);
    const paramAttributes: ModelAttributeType[] = [];
    for (const param of method.params) {
      if (param.annotations.some((annotation) => EXCLUDED_PARAM_ANNOTATIONS.has(annotation.name))) {
        continue;
      }
      const paramAnnotation = findAnnotation(param.annotations, `ModelAttribute`);
      const simple = simpleTypeName(param.type);
      if (!paramAnnotation && (SIMPLE_TYPES.has(simple) || FRAMEWORK_PARAM_TYPES.has(simple) || param.type.includes(`[`) || /^[a-z]/.test(simple))) {
        continue;
      }
      const explicit = annotationLiterals(paramAnnotation?.args ?? ``, [`value`, `name`])[0];
      paramAttributes.push({ ...buildAttribute(explicit ?? lowerFirst(simple), method.offset, param.name.length, `param`, method.name), "typeName": param.type });
    }
    if (!mapping) {
      if (modelAttributeAnnotation && method.returnType !== `void`) {
        const explicit = annotationLiterals(modelAttributeAnnotation.args, [`value`, `name`])[0];
        type.modelAttributeMethods.push({ ...buildAttribute(explicit ?? lowerFirst(simpleTypeName(method.returnType)), method.offset, method.name.length, `modelAttributeMethod`, method.name), "typeName": method.returnType });
      }
      continue;
    }
    const methodPaths = annotationLiterals(mapping.args, [`value`, `path`]);
    const paths = combinePaths(type.classPaths, methodPaths);
    const httpMethods = MAPPING_ANNOTATIONS[mapping.name].length > 0 ? MAPPING_ANNOTATIONS[mapping.name] : [...mapping.args.matchAll(/RequestMethod\.(\w+)/g)].map((match) => match[1]);

    // 응답 본문 핸들러
    const rendersView = !type.isRestController && !hasAnnotation(type.annotations, `ResponseBody`) && !hasAnnotation(method.annotations, `ResponseBody`);
    const viewNames = rendersView ? collectViewNames(masked, method, paths, positionOf) : [];
    const attributes = rendersView ? [...(attributesByMethod.get(method.name) ?? []), ...paramAttributes] : [];
    type.handlers.push({ "methodName": method.name, "line": method.line, "offset": method.offset, "paths": paths, "httpMethods": httpMethods, "viewNames": viewNames, "attributes": attributes, "dynamic": dynamicMethods.has(method.name) || delegatingHandlers.has(method.name) });
  }
  type.dynamicModel = dynamicMethods.size > 0;
};

// 10. 클래스·메서드 경로 결합 ------------------------------------------------------------------
const combinePaths = (classPaths: string[], methodPaths: string[]): string[] => {
  const normalize = (path: string): string => (path.startsWith(`/`) ? path : `/${path}`).replace(/\/+$/, ``) || `/`;
  if (classPaths.length === 0) {
    return methodPaths.map(normalize);
  }
  if (methodPaths.length === 0) {
    return classPaths.map(normalize);
  }
  const combined: string[] = [];
  for (const classPath of classPaths) {
    for (const methodPath of methodPaths) {
      combined.push(normalize(`${normalize(classPath)}${normalize(methodPath)}`.replace(/\/{2,}/g, `/`)));
    }
  }
  return combined;
};

// 11. 핸들러 뷰명 수집 ---------------------------------------------------------------------
const collectViewNames = (masked: string, method: JavaMethodType, paths: string[], positionOf: (offset: number) => { line: number; column: number }): JavaViewNameType[] => {
  const views: JavaViewNameType[] = [];
  const seen = new Set<number>();
  const pushView = (name: string, offset: number, implicit = false): void => {
    if (seen.has(offset) || name.trim() === `` || /^(redirect|forward):/.test(name) || name.includes(`\n`)) {
      return;
    }
    seen.add(offset);
    const position = positionOf(offset);
    views.push({ "name": name.trim(), "offset": offset, "length": name.length, "line": position.line, "column": position.column, "implicit": implicit });
  };
  if (method.bodyStart < 0) {
    return views;
  }
  const body = masked.slice(method.bodyStart, method.bodyEnd);
  const base = method.bodyStart;
  const attributeLiteralOffsets = new Set<number>();
  NEW_MAV_PATTERN.lastIndex = 0;
  for (const mav of body.matchAll(NEW_MAV_PATTERN)) {
    const viewOffset = base + mav.index + mav[0].indexOf(`"`) + 1;
    pushView(mav[1], viewOffset);
    if (mav[2]) {
      attributeLiteralOffsets.add(base + mav.index + mav[0].lastIndexOf(`"${mav[2]}"`) + 1);
    }
  }
  SET_VIEW_PATTERN.lastIndex = 0;
  for (const setter of body.matchAll(SET_VIEW_PATTERN)) {
    pushView(setter[1], base + setter.index + setter[0].indexOf(`"`) + 1);
  }
  RETURN_PATTERN.lastIndex = 0;
  for (const statement of body.matchAll(RETURN_PATTERN)) {
    const statementBase = base + statement.index + `return`.length;
    const expression = statement[1];
    const literalOnly = isViewLiteralExpression(expression);
    STRING_LITERAL_PATTERN.lastIndex = 0;
    let found = false;
    for (const literal of expression.matchAll(STRING_LITERAL_PATTERN)) {
      const offset = statementBase + literal.index + 1;
      if (attributeLiteralOffsets.has(offset)) {
        continue;
      }
      found = true;
      literalOnly && pushView(literal[1], offset);
    }
    const variable = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(expression)?.[1];
    if (!found && variable) {
      const assignPattern = new RegExp(`\\b${variable}\\s*=\\s*"([^"]*)"`, `g`);
      for (const assignment of body.matchAll(assignPattern)) {
        pushView(assignment[1], base + assignment.index + assignment[0].indexOf(`"`) + 1);
      }
    }
  }
  if (views.length === 0 && method.returnType === `void`) {
    for (const path of paths) {
      path.includes(`{`) || pushView(path.replace(/^\/+/, ``), method.offset, true);
    }
  }
  return views;
};

// 11-1. 리터럴 뷰명 반환식 판정 -----------------------------------------------
const isViewLiteralExpression = (expression: string): boolean => {
  let text = expression.trim();
  while (text.startsWith(`(`) && findMatching(text, 0, `(`, `)`) === text.length - 1) {
    text = text.slice(1, -1).trim();
  }
  if (/^"(?:[^"\\]|\\.)*"$/.test(text)) {
    return true;
  }
  const conditional = splitTopLevel(text, `?`);
  const branches = conditional.length === 2 ? splitTopLevel(conditional[1], `:`) : [];
  return branches.length === 2 && branches.every(isViewLiteralExpression);
};

// 12. 메서드 본문 지역 변수 타입 수집 -----------------------------------------------------------
export const collectLocalTypes = (bodyText: string, params: JavaParamType[]): Map<string, string> => {
  const locals = new Map<string, string>();
  for (const param of params) {
    locals.set(param.name, param.type);
  }
  LOCAL_DECL_PATTERN.lastIndex = 0;
  for (const match of bodyText.matchAll(LOCAL_DECL_PATTERN)) {
    const declaredType = match[1].replace(/\s+/g, ``);
    if (KEYWORD_SET.has(declaredType) || locals.has(match[2])) {
      continue;
    }
    if (declaredType === `var` && match[3] === `=`) {
      const rest = bodyText.slice(match.index + match[0].length);
      const end = rest.indexOf(`;`);
      locals.set(match[2], `var:${rest.slice(0, end < 0 ? rest.length : end).trim()}`);
      continue;
    }
    locals.set(match[2], declaredType);
  }
  return locals;
};

// 13. 값 표현식 타입 추론 -------------------------------------------------------------------
export const inferExpressionType = (expression: string, context: JavaInferenceContextType, depth = 0): string | undefined => {
  if (depth > 6) {
    return undefined;
  }
  let text = expression.trim();
  while (text.startsWith(`(`) && findMatching(text, 0, `(`, `)`) === text.length - 1) {
    text = text.slice(1, -1).trim();
  }
  const cast = /^\(\s*([A-Z][\w.<>]*)\s*\)\s*(.+)$/s.exec(text);
  if (cast) {
    return cast[1];
  }
  if (/^"/.test(text)) {
    return `String`;
  }
  if (/^'/.test(text)) {
    return `Character`;
  }
  if (/^-?\d/.test(text)) {
    return /[.eE]|[fFdD]$/.test(text) ? `Double` : /[lL]$/.test(text) ? `Long` : `Integer`;
  }
  if (text === `true` || text === `false`) {
    return `Boolean`;
  }
  if (text === `null`) {
    return undefined;
  }
  const ternary = /^(.+?)\?(.+):(.+)$/s.exec(text);
  if (ternary && !text.startsWith(`new`) && splitTopLevel(text, `?`).length > 1) {
    return inferExpressionType(splitTopLevel(text, `?`)[1]?.split(`:`)[0] ?? ``, context, depth + 1);
  }
  const construction = /^new\s+([\w.]+)\s*(<[^(]*>)?\s*(\(|\[)/.exec(text);
  if (construction) {
    const generics = construction[2] && construction[2] !== `<>` ? construction[2].replace(/\s+/g, ``) : ``;
    return construction[3] === `[` ? `${simpleTypeName(construction[1])}[]` : `${simpleTypeName(construction[1])}${generics}`;
  }
  const factory = COLLECTION_FACTORY_PATTERN.exec(text);
  if (factory) {
    return factory[1] === `Map` ? `Map` : factory[1] === `Set` ? `Set` : `List`;
  }
  const chain = splitChain(text);
  if (chain.length === 0) {
    return undefined;
  }
  let currentType = resolveChainRoot(chain[0], context, depth);
  for (const segment of chain.slice(1)) {
    if (!currentType) {
      return undefined;
    }
    currentType = resolveMember(currentType, segment, context);
  }
  return currentType;
};
const splitChain = (text: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote = ``;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === `\\`) {
        i++;
      }
      else if (ch === quote) {
        quote = ``;
      }
      continue;
    }
    if (ch === `"` || ch === `'`) {
      quote = ch;
    }
    else if (ch === `(` || ch === `[` || ch === `<`) {
      depth++;
    }
    else if (ch === `)` || ch === `]` || ch === `>`) {
      depth--;
    }
    else if (ch === `.` && depth === 0 && !/\d/.test(text[i - 1] ?? ``)) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((part) => part !== ``);
};
const resolveChainRoot = (segment: string, context: JavaInferenceContextType, depth: number): string | undefined => {
  const call = /^([A-Za-z_$][\w$]*)\s*\((.*)\)$/s.exec(segment);
  if (call) {
    const method = context.ownerType?.methods.find((candidate) => candidate.name === call[1]);
    return method ? method.returnType : undefined;
  }
  if (segment === `this`) {
    return context.ownerType?.name;
  }
  const local = context.locals.get(segment) ?? context.params.get(segment) ?? context.fields.get(segment);
  if (local) {
    return local.startsWith(`var:`) ? inferExpressionType(local.slice(4), context, depth + 1) : local;
  }
  if (/^[A-Z]/.test(segment) && context.lookupType(segment)) {
    return `static:${segment}`;
  }
  return undefined;
};
const resolveMember = (ownerType: string, segment: string, context: JavaInferenceContextType): string | undefined => {
  const ownerName = simpleTypeName(ownerType.replace(/^static:/, ``));
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(segment);
  const memberName = call ? call[1] : segment.replace(/\[.*$/, ``).trim();
  const visited = new Set<string>();
  let currentName: string | undefined = ownerName;
  while (currentName && !visited.has(currentName)) {
    visited.add(currentName);
    const type = context.lookupType(currentName);
    if (!type) {
      return undefined;
    }
    if (call) {
      const method = type.methods.find((candidate) => candidate.name === memberName);
      if (method) {
        return method.returnType === `void` ? undefined : method.returnType;
      }
      const getter = /^(?:get|is)([A-Z]\w*)$/.exec(memberName);
      const field = getter ? type.fields.find((candidate) => candidate.name.toLowerCase() === getter[1].toLowerCase()) : undefined;
      if (field) {
        return field.type;
      }
    }
    else {
      const field = type.fields.find((candidate) => candidate.name === memberName) ?? type.recordComponents.find((candidate) => candidate.name === memberName);
      if (field) {
        return field.type;
      }
    }
    currentName = type.extendsName;
  }
  return undefined;
};

// 14. 컨트롤러 속성 타입 보강 (인덱스 완성 후 호출) ----------------------------------------------------
export const resolveAttributeTypes = (file: JavaFileType, text: string, lookupType: (simpleName: string) => JavaTypeType | undefined): void => {
  const { masked } = maskSource(text);
  for (const type of file.types) {
    if (!isModelSource(type)) {
      continue;
    }
    const fields = new Map(type.fields.map((field) => [field.name, field.type]));
    for (const attribute of [...type.classAttributes, ...type.flashAttributes]) {
      if (attribute.typeName !== undefined || attribute.valueExpr === undefined) {
        continue;
      }
      const method = type.methods.find((candidate) => candidate.name === attribute.methodName);
      const bodyText = method && method.bodyStart >= 0 ? masked.slice(method.bodyStart, method.bodyEnd) : ``;
      const locals = collectLocalTypes(bodyText, method?.params ?? []);
      const context: JavaInferenceContextType = { "params": new Map((method?.params ?? []).map((param) => [param.name, param.type])), "locals": locals, "fields": fields, "ownerType": type, "lookupType": lookupType };
      attribute.typeName = inferExpressionType(attribute.valueExpr, context);
    }
  }
};
