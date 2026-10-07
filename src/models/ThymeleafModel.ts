// models/ThymeleafModel.ts

import { findDialectAttribute, isPassthroughAttribute, listStandardAttributeNames } from "@exportData";
import type { AnalysisOptionsType, DialectPrefixType, ExpressionIssueType, FragmentReferenceType, TemplateAnalysisType, TemplateAttributeType, TemplateDiagnosticType, TemplateFragmentType, TemplateInlineType, TemplateModelType, TextPositionType } from "@exportTypes";

const TAG_NAME_PATTERN = /[A-Za-z][\w:.-]*/y;
const ATTR_NAME_PATTERN = /[^\s"'<>/=]+/y;
const UNQUOTED_VALUE_PATTERN = /[^\s>]*/y;
const DIALECT_ATTR_PATTERN = /^(?:(th|sec|layout):|data-(th|sec|layout)-)([\w.-]+)$/;
const SCRIPT_CLOSE_PATTERN = /<\/script\s*>/gi;
const STYLE_CLOSE_PATTERN = /<\/style\s*>/gi;
const EACH_PATTERN = /^\s*[\w$]+\s*(?:,\s*[\w$]+\s*)?:\s*\S[\s\S]*$/;
const FRAGMENT_DEF_PATTERN = /^\s*([\w$-]+)\s*(?:\(([^)]*)\))?\s*$/;
const FRAGMENT_REF_PATTERN = /^\s*(?:~\{)?\s*([\w/.-]*)\s*(?:::\s*([^}]*?))?\s*\}?\s*$/;
const EXPRESSION_START_PATTERN = /[$*#@~]\{/;
const MESSAGE_KEY_PATTERN = /^[\w.-]+$/;
const INLINE_VALUES: ReadonlySet<string> = new Set([`text`, `javascript`, `css`, `none`]);
const REMOVE_VALUES: ReadonlySet<string> = new Set([`all`, `body`, `tag`, `all-but-first`, `none`]);
const CLOSER_MAP: Readonly<Record<string, string>> = { ")": `(`, "]": `[`, "}": `{` };
const MAX_SUGGEST_DISTANCE = 2;

interface BracketFrameType {
  ch: string;
  offset: number;
  kind: string;
}

// 1. 라인 시작 오프셋 테이블 -----------------------------------------------------------
export const buildLineStarts = (text: string): number[] => {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    text.charCodeAt(i) === 10 && lineStarts.push(i + 1);
  }
  return lineStarts;
};

// 2. 오프셋 -> 0-based 위치 (이진 탐색) ------------------------------------------------
export const offsetToPosition = (lineStarts: number[], offset: number): TextPositionType => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= offset) {
      low = mid;
    }
    else {
      high = mid - 1;
    }
  }
  return { "line": low, "column": offset - lineStarts[low] };
};

// 3. 인라인 표현식 스캔 ----------------------------------------------------------------
const scanInlines = (text: string, start: number, end: number, scriptMode: boolean, inlines: TemplateInlineType[]): void => {
  let cursor = start;
  while (cursor < end) {
    const escapedAt = text.indexOf(`[[`, cursor);
    const unescapedAt = text.indexOf(`[(`, cursor);
    const candidates = [escapedAt, unescapedAt].filter((index) => index >= 0 && index < end);
    if (candidates.length === 0) {
      return;
    }
    const openAt = Math.min(...candidates);
    const kind = openAt === escapedAt ? `escaped` : `unescaped`;
    const closer = kind === `escaped` ? `]]` : `)]`;
    const closeAt = text.indexOf(closer, openAt + 2);
    if (closeAt < 0 || closeAt >= end) {
      inlines.push({ "kind": kind, "content": text.slice(openAt + 2, end), "offset": openAt, "length": end - openAt, "closed": false, "scriptMode": scriptMode });
      return;
    }
    inlines.push({ "kind": kind, "content": text.slice(openAt + 2, closeAt), "offset": openAt, "length": closeAt + 2 - openAt, "closed": true, "scriptMode": scriptMode });
    cursor = closeAt + 2;
  }
};

// 4. 공백 건너뛰기 -------------------------------------------------------------------
const skipWhitespace = (text: string, cursor: number): number => {
  let next = cursor;
  while (next < text.length && /\s/.test(text[next])) {
    next++;
  }
  return next;
};

// 5. 프래그먼트 정의 파싱 ---------------------------------------------------------------
const toFragment = (attribute: TemplateAttributeType): TemplateFragmentType | undefined => {
  const matched = FRAGMENT_DEF_PATTERN.exec(attribute.value);
  if (!matched) {
    return undefined;
  }
  const params = (matched[2] ?? ``).split(`,`).map((param) => param.trim()).filter((param) => param.length > 0);
  return { "name": matched[1], "params": params, "prefix": attribute.prefix, "tag": attribute.tag, "offset": attribute.tagOffset, "length": attribute.valueOffset + attribute.value.length + 1 - attribute.tagOffset };
};

// 6. 템플릿 파싱 (요소·속성·인라인·프래그먼트) ------------------------------------------------
export const parseTemplate = (text: string): TemplateModelType => {
  const attributes: TemplateAttributeType[] = [];
  const inlines: TemplateInlineType[] = [];
  const fragments: TemplateFragmentType[] = [];
  let hasNamespace = false;
  let elementIndex = 0;
  let cursor = 0;
  const length = text.length;

  while (cursor < length) {
    const lt = text.indexOf(`<`, cursor);
    if (lt < 0) {
      scanInlines(text, cursor, length, false, inlines);
      break;
    }
    scanInlines(text, cursor, lt, false, inlines);

    // 주석·선언·닫는 태그
    if (text.startsWith(`<!--`, lt)) {
      if (text.startsWith(`<!--/*/`, lt)) {
        cursor = lt + 7;
        continue;
      }
      const end = text.indexOf(`-->`, lt + 4);
      cursor = end < 0 ? length : end + 3;
      continue;
    }
    if (text.startsWith(`<![CDATA[`, lt)) {
      const end = text.indexOf(`]]>`, lt);
      cursor = end < 0 ? length : end + 3;
      continue;
    }
    if (text[lt + 1] === `!` || text[lt + 1] === `?` || text[lt + 1] === `/`) {
      const end = text.indexOf(`>`, lt);
      cursor = end < 0 ? length : end + 1;
      continue;
    }

    // 여는 태그
    TAG_NAME_PATTERN.lastIndex = lt + 1;
    const tagMatch = TAG_NAME_PATTERN.exec(text);
    if (!tagMatch) {
      cursor = lt + 1;
      continue;
    }
    const tag = tagMatch[0];
    const elementAttrs: TemplateAttributeType[] = [];
    let pointer = lt + 1 + tag.length;
    let selfClosing = false;
    let closed = false;
    while (pointer < length) {
      pointer = skipWhitespace(text, pointer);
      if (text[pointer] === `>`) {
        pointer++;
        closed = true;
        break;
      }
      if (text.startsWith(`/>`, pointer)) {
        pointer += 2;
        selfClosing = true;
        closed = true;
        break;
      }
      if (text[pointer] === `<`) {
        break;
      }
      ATTR_NAME_PATTERN.lastIndex = pointer;
      const attrMatch = ATTR_NAME_PATTERN.exec(text);
      if (!attrMatch) {
        pointer++;
        continue;
      }
      const attrName = attrMatch[0];
      const nameOffset = pointer;
      pointer += attrName.length;
      pointer = skipWhitespace(text, pointer);
      let value = ``;
      let valueOffset = -1;
      let quote = ``;
      let unclosedQuote = false;
      if (text[pointer] === `=`) {
        pointer = skipWhitespace(text, pointer + 1);
        const quoteChar = text[pointer];
        if (quoteChar === `"` || quoteChar === `'`) {
          const closeAt = text.indexOf(quoteChar, pointer + 1);
          quote = quoteChar;
          valueOffset = pointer + 1;
          if (closeAt < 0) {
            value = text.slice(pointer + 1);
            pointer = length;
            unclosedQuote = true;
          }
          else {
            value = text.slice(pointer + 1, closeAt);
            pointer = closeAt + 1;
          }
        }
        else {
          UNQUOTED_VALUE_PATTERN.lastIndex = pointer;
          const unquoted = UNQUOTED_VALUE_PATTERN.exec(text)?.[0] ?? ``;
          value = unquoted;
          valueOffset = pointer;
          pointer += unquoted.length;
        }
      }
      if (attrName.toLowerCase() === `xmlns:th`) {
        hasNamespace = true;
      }
      const dialectMatch = DIALECT_ATTR_PATTERN.exec(attrName);
      if (dialectMatch) {
        const prefix = (dialectMatch[1] ?? dialectMatch[2]) as DialectPrefixType;
        elementAttrs.push({ "prefix": prefix, "name": dialectMatch[3], "raw": attrName, "value": value, "hasValue": valueOffset >= 0, "nameOffset": nameOffset, "valueOffset": valueOffset, "quote": quote, "tag": tag, "tagOffset": lt, "elementIndex": elementIndex });
      }
      if (unclosedQuote) {
        break;
      }
    }
    elementIndex++;
    attributes.push(...elementAttrs);
    for (const attribute of elementAttrs) {
      if (attribute.name === `fragment` && (attribute.prefix === `th` || attribute.prefix === `layout`)) {
        const fragment = toFragment(attribute);
        fragment && fragments.push(fragment);
      }
    }
    cursor = pointer;

    // script/style 본문 (인라인 모드일 때만 스캔)
    const lowerTag = tag.toLowerCase();
    if (!selfClosing && closed && (lowerTag === `script` || lowerTag === `style`)) {
      const closePattern = lowerTag === `script` ? SCRIPT_CLOSE_PATTERN : STYLE_CLOSE_PATTERN;
      closePattern.lastIndex = pointer;
      const closeMatch = closePattern.exec(text);
      const contentEnd = closeMatch ? closeMatch.index : length;
      const inlineMode = elementAttrs.find((attribute) => attribute.prefix === `th` && attribute.name === `inline`)?.value.trim().toLowerCase();
      (inlineMode === `javascript` || inlineMode === `css`) && scanInlines(text, pointer, contentEnd, true, inlines);
      cursor = contentEnd;
    }
  }

  return { "attributes": attributes, "inlines": inlines, "fragments": fragments, "hasNamespace": hasNamespace, "isThymeleaf": hasNamespace || attributes.length > 0 };
};

// 7. 표현식 구문 검사 -------------------------------------------------------------------
export const checkExpression = (value: string): ExpressionIssueType[] => {
  const issues: ExpressionIssueType[] = [];
  const stack: BracketFrameType[] = [];
  const size = value.length;
  let inLiteral = false;
  let literalOffset = -1;
  let inPreprocess = false;
  let cursor = 0;

  const insideExpression = (): boolean => stack.some((frame) => frame.kind !== ``);

  while (cursor < size) {
    const ch = value[cursor];

    // 문자열 리터럴 (리터럴 치환 최상위에서는 작은따옴표 허용)
    if (ch === `'` && !(inLiteral && stack.length === 0)) {
      let end = cursor + 1;
      let closedString = false;
      while (end < size) {
        if (value[end] === `\\`) {
          end += 2;
          continue;
        }
        if (value[end] === `'`) {
          closedString = true;
          break;
        }
        end++;
      }
      if (!closedString) {
        issues.push({ "code": `thymeleaf-unclosed-string`, "message": `Unclosed string literal.`, "severity": `error`, "offset": cursor, "length": size - cursor });
        return issues;
      }
      cursor = end + 1;
      continue;
    }

    // 표현식 시작
    if ((ch === `$` || ch === `*` || ch === `#` || ch === `@` || ch === `~`) && value[cursor + 1] === `{`) {
      if ((ch === `$` || ch === `*`) && !inPreprocess && stack.some((frame) => frame.kind === `$` || frame.kind === `*`)) {
        issues.push({ "code": `thymeleaf-nested-expression`, "message": `Nested ${ch}{...} inside a variable or selection expression is not allowed. Use preprocessing __${ch}{...}__ if intended.`, "severity": `warning`, "offset": cursor, "length": 2 });
      }
      stack.push({ "ch": `{`, "offset": cursor, "kind": ch });
      cursor += 2;
      continue;
    }

    // 전처리 토글
    if (ch === `_` && value[cursor + 1] === `_`) {
      inPreprocess = !inPreprocess;
      cursor += 2;
      continue;
    }

    // 리터럴 치환 토글 (표현식 밖에서만)
    if (ch === `|` && !insideExpression()) {
      if (inLiteral) {
        inLiteral = false;
      }
      else {
        inLiteral = true;
        literalOffset = cursor;
      }
      cursor++;
      continue;
    }

    // 여는 괄호
    if (ch === `(` || ch === `[` || ch === `{`) {
      stack.push({ "ch": ch, "offset": cursor, "kind": `` });
      cursor++;
      continue;
    }

    // 닫는 괄호
    if (ch === `)` || ch === `]` || ch === `}`) {
      const expected = CLOSER_MAP[ch];
      const top = stack.at(-1);
      if (!top) {
        issues.push({ "code": `thymeleaf-unexpected-closing`, "message": `Unexpected '${ch}' without a matching opener.`, "severity": `error`, "offset": cursor, "length": 1 });
        cursor++;
        continue;
      }
      if (top.ch !== expected) {
        const outerIndex = stack.findLastIndex((frame) => frame.ch === expected);
        if (outerIndex < 0) {
          const opener = top.kind ? `${top.kind}{` : top.ch;
          issues.push({ "code": `thymeleaf-mismatched-bracket`, "message": `Mismatched '${ch}': expected a closer for '${opener}'.`, "severity": `error`, "offset": cursor, "length": 1 });
          cursor++;
          continue;
        }
        // 바깥 괄호가 닫힘: 사이에 남은 안쪽 괄호는 미닫힘 처리
        for (const inner of stack.splice(outerIndex + 1)) {
          const opener = inner.kind ? `${inner.kind}{` : inner.ch;
          issues.push({ "code": `thymeleaf-unclosed-expression`, "message": `Unclosed '${opener}'.`, "severity": `error`, "offset": inner.offset, "length": cursor - inner.offset });
        }
      }
      const closedFrame = stack.pop() ?? top;
      if (closedFrame.kind !== `` && ch === `}`) {
        const inner = value.slice(closedFrame.offset + 2, cursor);
        if (inner.trim() === ``) {
          issues.push({ "code": `thymeleaf-empty-expression`, "message": `Empty ${closedFrame.kind}{} expression.`, "severity": `warning`, "offset": closedFrame.offset, "length": cursor - closedFrame.offset + 1 });
        }
        else if (closedFrame.kind === `#`) {
          const key = inner.split(`(`)[0].trim();
          const dynamicKey = key.includes(`\${`) || key.includes(`__`) || key.includes(`*{`);
          if (!dynamicKey && !MESSAGE_KEY_PATTERN.test(key)) {
            issues.push({ "code": `thymeleaf-invalid-message-key`, "message": `Invalid message key '${key}'. Use dotted identifiers such as home.welcome or a \${...} expression.`, "severity": `warning`, "offset": closedFrame.offset + 2, "length": Math.max(1, key.length) });
          }
        }
      }
      cursor++;
      continue;
    }
    cursor++;
  }

  for (const frame of stack) {
    const opener = frame.kind ? `${frame.kind}{` : frame.ch;
    issues.push({ "code": `thymeleaf-unclosed-expression`, "message": `Unclosed '${opener}'.`, "severity": `error`, "offset": frame.offset, "length": size - frame.offset });
  }
  inLiteral && issues.push({ "code": `thymeleaf-unclosed-literal-substitution`, "message": `Unclosed literal substitution '|...|'.`, "severity": `error`, "offset": literalOffset, "length": size - literalOffset });
  return issues;
};

// 8. 프래그먼트 참조 파싱 ---------------------------------------------------------------
export const parseFragmentReference = (value: string): FragmentReferenceType | undefined => {
  const trimmed = value.trim();
  if (trimmed === ``) {
    return undefined;
  }
  const dynamic = EXPRESSION_START_PATTERN.test(trimmed.replace(/^~\{/, ``));
  const matched = FRAGMENT_REF_PATTERN.exec(trimmed);
  if (!matched) {
    return { "template": ``, "selector": ``, "dynamic": true };
  }
  const template = matched[1] === `this` ? `` : matched[1];
  return { "template": template, "selector": (matched[2] ?? ``).trim(), "dynamic": dynamic };
};

// 9. 레벤슈타인 거리 -------------------------------------------------------------------
const measureDistance = (left: string, right: string): number => {
  const rows = left.length + 1;
  const cols = right.length + 1;
  let previous = Array.from({ "length": cols }, (_, index) => index);
  for (let row = 1; row < rows; row++) {
    const current = [row];
    for (let col = 1; col < cols; col++) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      current[col] = Math.min(previous[col] + 1, current[col - 1] + 1, previous[col - 1] + cost);
    }
    previous = current;
  }
  return previous[cols - 1];
};

// 10. 속성명 교정 제안 -----------------------------------------------------------------
export const suggestAttributeName = (name: string): string | undefined => {
  if (name.length < 3) {
    return undefined;
  }
  let best: string | undefined;
  let bestDistance = MAX_SUGGEST_DISTANCE + 1;
  for (const candidate of listStandardAttributeNames()) {
    const distance = measureDistance(name, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= MAX_SUGGEST_DISTANCE ? best : undefined;
};

// 11. 오프셋 위치의 다이얼렉트 속성 탐색 ---------------------------------------------------
export const findAttributeAt = (template: TemplateModelType, offset: number): TemplateAttributeType | undefined => template.attributes.find((attribute) => offset >= attribute.nameOffset && offset <= (attribute.hasValue ? attribute.valueOffset + attribute.value.length + 1 : attribute.nameOffset + attribute.raw.length));

// 12. 템플릿 분석 (파싱 + 진단) ----------------------------------------------------------
export const analyzeTemplate = (text: string, options: AnalysisOptionsType = {}): TemplateAnalysisType => {
  const template = parseTemplate(text);
  const diagnostics: TemplateDiagnosticType[] = [];
  if (!template.isThymeleaf) {
    return { "template": template, "diagnostics": diagnostics };
  }
  const lineStarts = buildLineStarts(text);
  const extraNames: ReadonlySet<string> = new Set(options.additionalAttributes ?? []);
  const push = (issue: ExpressionIssueType): void => {
    const position = offsetToPosition(lineStarts, issue.offset);
    diagnostics.push({ ...issue, "line": position.line, "column": position.column });
  };
  const pushAt = (offset: number, length: number, code: string, message: string, severity: ExpressionIssueType[`severity`]): void => {
    push({ "code": code, "message": message, "severity": severity, "offset": offset, "length": Math.max(1, length) });
  };

  // 요소별 중복 속성
  const seenByElement = new Map<number, Set<string>>();
  for (const attribute of template.attributes) {
    const seen = seenByElement.get(attribute.elementIndex) ?? new Set<string>();
    const key = `${attribute.prefix}:${attribute.name}`;
    seen.has(key) ? pushAt(attribute.nameOffset, attribute.raw.length, `thymeleaf-duplicate-attribute`, `Duplicate attribute '${key}' on the same element.`, `error`) : seen.add(key);
    seenByElement.set(attribute.elementIndex, seen);
  }

  for (const attribute of template.attributes) {
    const label = `${attribute.prefix}:${attribute.name}`;
    const valueLength = attribute.value.length;

    // 값 누락·공백
    if (!attribute.hasValue) {
      pushAt(attribute.nameOffset, attribute.raw.length, `thymeleaf-missing-value`, `Attribute '${label}' requires a value.`, `warning`);
      continue;
    }
    if (attribute.value.trim() === ``) {
      pushAt(attribute.nameOffset, attribute.raw.length, `thymeleaf-empty-value`, `Attribute '${label}' has an empty value.`, `warning`);
      continue;
    }

    // 속성명 검증
    const definition = findDialectAttribute(attribute.prefix, attribute.name);
    if (!definition && !isPassthroughAttribute(attribute.name) && !extraNames.has(attribute.name)) {
      const suggestion = attribute.prefix === `th` ? suggestAttributeName(attribute.name) : undefined;
      const hint = suggestion ? ` Did you mean 'th:${suggestion}'?` : attribute.prefix === `th` ? ` It will be rendered as a plain '${attribute.name}' attribute.` : ``;
      pushAt(attribute.nameOffset, attribute.raw.length, `thymeleaf-unknown-attribute`, `Unknown attribute '${label}'.${hint}`, suggestion ? `warning` : `information`);
    }
    definition?.deprecated && pushAt(attribute.nameOffset, attribute.raw.length, `thymeleaf-deprecated-attribute`, `'${label}' is deprecated. ${definition.deprecated}`, `warning`);

    // 표현식 구문
    for (const issue of checkExpression(attribute.value)) {
      push({ ...issue, "offset": attribute.valueOffset + issue.offset });
    }

    // 종류별 검증
    const kind = definition?.kind;
    const trimmed = attribute.value.trim();
    const hasExpression = EXPRESSION_START_PATTERN.test(trimmed);
    if (kind === `each` && !EACH_PATTERN.test(attribute.value)) {
      pushAt(attribute.valueOffset, valueLength, `thymeleaf-invalid-each`, `Invalid th:each syntax. Expected 'item : \${items}' or 'item, stat : \${items}'.`, `error`);
    }
    else if (kind === `inline` && !hasExpression && !INLINE_VALUES.has(trimmed)) {
      pushAt(attribute.valueOffset, valueLength, `thymeleaf-invalid-inline`, `Invalid th:inline mode '${trimmed}'. Expected text, javascript, css, or none.`, `error`);
    }
    else if (kind === `remove` && !hasExpression && !REMOVE_VALUES.has(trimmed)) {
      pushAt(attribute.valueOffset, valueLength, `thymeleaf-invalid-remove`, `Invalid th:remove mode '${trimmed}'. Expected all, body, tag, all-but-first, or none.`, `error`);
    }
    else if (kind === `fragment-def` && !FRAGMENT_DEF_PATTERN.test(attribute.value)) {
      pushAt(attribute.valueOffset, valueLength, `thymeleaf-invalid-fragment`, `Invalid fragment signature. Expected 'name' or 'name(param1, param2)'.`, `error`);
    }
    else if (kind === `assignation` && !attribute.value.includes(`=`)) {
      pushAt(attribute.valueOffset, valueLength, `thymeleaf-invalid-assignation`, `'${label}' expects 'name=value' pairs separated by commas.`, `error`);
    }
    else if (kind === `object` && !trimmed.startsWith(`\${`)) {
      pushAt(attribute.valueOffset, valueLength, `thymeleaf-object-expression`, `th:object expects a variable expression \${...}.`, `warning`);
    }
    else if (kind === `utext`) {
      pushAt(attribute.nameOffset, attribute.raw.length, `thymeleaf-unescaped-text`, `th:utext renders unescaped HTML. Make sure the value is not user-controlled.`, `hint`);
    }
  }

  // 인라인 표현식
  for (const inline of template.inlines) {
    const closer = inline.kind === `escaped` ? `]]` : `)]`;
    if (!inline.closed) {
      (!inline.scriptMode || EXPRESSION_START_PATTERN.test(inline.content)) && pushAt(inline.offset, 2, `thymeleaf-unclosed-inline`, `Unclosed inline expression. Expected '${closer}'.`, `error`);
      continue;
    }
    if (inline.scriptMode && !EXPRESSION_START_PATTERN.test(inline.content)) {
      continue;
    }
    for (const issue of checkExpression(inline.content)) {
      push({ ...issue, "offset": inline.offset + 2 + issue.offset });
    }
  }

  return { "template": template, "diagnostics": diagnostics };
};
