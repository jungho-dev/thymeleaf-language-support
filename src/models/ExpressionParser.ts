// models/ExpressionParser.ts

import type { AttributeKindType, ChainRootType, ChainSegmentType, ExpressionChainType, ExpressionIssueType, ExpressionKindType, ExpressionNodeType, ParsedValueType } from "@exportTypes";

const IDENT_PATTERN = /[A-Za-z_$][\w$]*/y;
const TOKEN_PATTERN = /[A-Za-z0-9[\]._-]+/y;
const NUMBER_PATTERN = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[LlFfDd]?|0[xX][0-9a-fA-F]+/y;
const PARAM_NAME_PATTERN = /[\w.:[\]-]+/y;
const NAMED_ARG_PATTERN = /[A-Za-z_][\w]*\s*=(?!=)/y;
const EACH_HEAD_PATTERN = /\s*([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?:(?!:)/y;
const FRAGMENT_DEF_PATTERN = /^\s*([\w$-]+)\s*(?:\(([^)]*)\))?\s*$/;
const TYPE_NAME_PATTERN = /[\w.$]+(?:\s*<[^>]*>)?(?:\s*\[\s*\])*/y;
const EMBEDDED_KIND_MAP: Readonly<Record<string, ExpressionKindType>> = { "$": `variable`, "*": `selection`, "#": `message`, "@": `link`, "~": `fragment` };
const SYMBOL_RELATIONAL = [`==`, `!=`, `>=`, `<=`, `>`, `<`];
const WORD_RELATIONAL = [`eq`, `ne`, `gt`, `ge`, `lt`, `le`];
const SPEL_WORD_RELATIONAL = [...WORD_RELATIONAL, `instanceof`, `matches`, `between`];
const SPEL_KEYWORDS: ReadonlySet<string> = new Set([`and`, `or`, `not`, `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `div`, `mod`, `instanceof`, `matches`, `between`]);

class ParseError extends Error {
  readonly offset: number;
  readonly length: number;
  constructor(message: string, offset: number, length = 1) {
    super(message);
    this.offset = offset;
    this.length = length;
  }
}

// ------------------------------------------------------------------------------
// 1. Thymeleaf 표준 표현식 + SpEL 서브셋 재귀하강 파서
// ------------------------------------------------------------------------------
class ExpressionScanner {
  readonly src: string;
  readonly nodes: ExpressionNodeType[] = [];
  pos = 0;

  constructor(src: string) {
    this.src = src;
  }

  // 1-1. 커서 유틸
  peek(ahead = 0): string {
    return this.src[this.pos + ahead] ?? ``;
  }
  eof(): boolean {
    return this.pos >= this.src.length;
  }
  startsWith(text: string): boolean {
    return this.src.startsWith(text, this.pos);
  }
  skipWs(): void {
    while (!this.eof() && /\s/.test(this.peek())) {
      this.pos++;
    }
  }
  consume(text: string): boolean {
    if (!this.startsWith(text)) {
      return false;
    }
    this.pos += text.length;
    return true;
  }
  expect(text: string, message: string): void {
    if (!this.consume(text)) {
      throw new ParseError(message, this.pos, Math.max(1, Math.min(text.length, this.src.length - this.pos)));
    }
  }
  matchAt(pattern: RegExp): string | undefined {
    pattern.lastIndex = this.pos;
    const matched = pattern.exec(this.src);
    return matched && matched.index === this.pos ? matched[0] : undefined;
  }
  wordAt(): string | undefined {
    return this.matchAt(IDENT_PATTERN);
  }
  consumeWord(word: string): boolean {
    if (this.wordAt() !== word) {
      return false;
    }
    this.pos += word.length;
    return true;
  }
  consumeAny(options: string[]): string | undefined {
    for (const option of options) {
      if (this.consume(option)) {
        return option;
      }
    }
    return undefined;
  }
  consumeAnyWord(options: string[]): string | undefined {
    for (const option of options) {
      if (this.consumeWord(option)) {
        return option;
      }
    }
    return undefined;
  }
  isEmbeddedStart(): boolean {
    return this.peek(1) === `{` && this.peek() in EMBEDDED_KIND_MAP;
  }
  isStop(stops: string): boolean {
    return this.eof() || (stops !== `` && stops.includes(this.peek()));
  }
  unexpected(): ParseError {
    const word = this.matchAt(TOKEN_PATTERN);
    if (word) {
      return new ParseError(`Unexpected token '${word}'. Quote literal text as '...' or add an operator.`, this.pos, word.length);
    }
    return new ParseError(`Unexpected '${this.peek()}'.`, this.pos, 1);
  }

  // 2-1. 표준 표현식 (속성 최상위)
  parseStandard(stops: string): void {
    this.parseConditional(stops);
    this.skipWs();
    if (!this.isStop(stops)) {
      throw this.unexpected();
    }
  }
  parseConditional(stops: string): void {
    this.parseOr(stops);
    while (true) {
      this.skipWs();
      if (this.consume(`?:`)) {
        this.parseOr(stops);
        continue;
      }
      if (this.peek() === `?`) {
        this.pos++;
        this.parseConditional(`${stops}:`);
        this.skipWs();
        if (this.consume(`:`)) {
          this.parseConditional(stops);
        }
        return;
      }
      return;
    }
  }
  parseOr(stops: string): void {
    this.parseAnd(stops);
    while (true) {
      this.skipWs();
      if (this.consumeWord(`or`) || this.consume(`||`)) {
        this.parseAnd(stops);
        continue;
      }
      return;
    }
  }
  parseAnd(stops: string): void {
    this.parseNot(stops);
    while (true) {
      this.skipWs();
      if (this.consumeWord(`and`) || this.consume(`&&`)) {
        this.parseNot(stops);
        continue;
      }
      return;
    }
  }
  parseNot(stops: string): void {
    this.skipWs();
    if (this.consumeWord(`not`) || (this.peek() === `!` && this.peek(1) !== `=` && this.consume(`!`))) {
      this.parseNot(stops);
      return;
    }
    this.parseRelational(stops);
  }
  parseRelational(stops: string): void {
    this.parseAdditive(stops);
    while (true) {
      this.skipWs();
      if (this.consumeAny(SYMBOL_RELATIONAL) || this.consumeAnyWord(WORD_RELATIONAL)) {
        this.parseAdditive(stops);
        continue;
      }
      return;
    }
  }
  parseAdditive(stops: string): void {
    this.parseMultiplicative(stops);
    while (true) {
      this.skipWs();
      if (this.consumeAny([`+`, `-`])) {
        this.parseMultiplicative(stops);
        continue;
      }
      return;
    }
  }
  parseMultiplicative(stops: string): void {
    this.parseUnary(stops);
    while (true) {
      this.skipWs();
      if (this.consumeAny([`*`, `/`, `%`]) || this.consumeAnyWord([`div`, `mod`])) {
        this.parseUnary(stops);
        continue;
      }
      return;
    }
  }
  parseUnary(stops: string): void {
    this.skipWs();
    if (this.peek() === `-` && !/\d/.test(this.peek(1))) {
      this.pos++;
      this.parseUnary(stops);
      return;
    }
    this.parseAtom(stops);
  }
  parseAtom(stops: string): void {
    this.skipWs();
    if (this.isStop(stops)) {
      throw new ParseError(`Expected an expression.`, this.pos, 1);
    }
    if (this.isEmbeddedStart()) {
      this.parseEmbedded();
      return;
    }
    if (this.peek() === `|`) {
      this.parseLiteralSubstitution();
      return;
    }
    if (this.startsWith(`__`)) {
      this.parsePreprocessing();
      return;
    }
    if (this.peek() === `'`) {
      this.parseTextLiteral(`'`);
      return;
    }
    if (this.peek() === `(`) {
      this.pos++;
      this.parseConditional(`)`);
      this.skipWs();
      this.expect(`)`, `Expected ')' to close the parenthesis.`);
      return;
    }
    if (this.peek() === `-` && /\d/.test(this.peek(1))) {
      this.pos++;
    }
    const token = this.matchAt(TOKEN_PATTERN);
    if (token) {
      this.pos += token.length;
      return;
    }
    throw this.unexpected();
  }

  // 2-2. 리터럴·치환·전처리
  parseTextLiteral(quote: string): void {
    const start = this.pos;
    this.pos++;
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === `\\`) {
        this.pos += 2;
        continue;
      }
      if (ch === quote) {
        if (this.peek(1) === quote) {
          this.pos += 2;
          continue;
        }
        this.pos++;
        return;
      }
      this.pos++;
    }
    throw new ParseError(`Unterminated string literal.`, start, this.src.length - start);
  }
  parseLiteralSubstitution(): void {
    const start = this.pos;
    this.pos++;
    while (!this.eof()) {
      if (this.isEmbeddedStart()) {
        this.parseEmbedded();
        continue;
      }
      if (this.startsWith(`__`)) {
        this.parsePreprocessing();
        continue;
      }
      if (this.peek() === `|`) {
        this.pos++;
        return;
      }
      this.pos++;
    }
    throw new ParseError(`Unclosed literal substitution '|...|'.`, start, this.src.length - start);
  }
  parsePreprocessing(): void {
    const start = this.pos;
    this.pos += 2;
    const end = this.src.indexOf(`__`, this.pos);
    if (end < 0) {
      throw new ParseError(`Unclosed preprocessing '__...__'.`, start, this.src.length - start);
    }
    const inner = this.src.slice(this.pos, end);
    const sub = new ExpressionScanner(inner);
    sub.parseStandard(``);
    for (const node of sub.nodes) {
      this.nodes.push(shiftNode(node, this.pos));
    }
    this.pos = end + 2;
  }

  // 3-1. 내장 표현식 ${} *{} #{} @{} ~{}
  parseEmbedded(): ExpressionNodeType {
    const start = this.pos;
    const kind = EMBEDDED_KIND_MAP[this.peek()];
    this.pos += 2;
    const node: ExpressionNodeType = { "kind": kind, "offset": start, "length": 0, "inner": ``, "innerOffset": this.pos, "chains": [], "pathVariables": [], "args": [], "namedArgs": false, "argsOffset": -1 };
    this.nodes.push(node);
    const opener = this.src.slice(start, start + 2);
    if (kind === `variable` || kind === `selection`) {
      this.skipWs();
      if (this.peek() !== `}`) {
        this.parseSpel(`}`, node);
      }
      this.skipWs();
      this.expect(`}`, `Expected '}' to close '${opener}'.`);
    }
    else if (kind === `message`) {
      this.parseMessageBody(node);
    }
    else if (kind === `link`) {
      this.parseLinkBody(node);
    }
    else {
      this.parseFragmentBody(node, true);
    }
    node.length = this.pos - start;
    node.inner = this.src.slice(node.innerOffset, this.pos - 1);
    return node;
  }

  // 3-2. 메시지 본문
  parseMessageBody(node: ExpressionNodeType): void {
    this.skipWs();
    const keyStart = this.pos;
    let dynamic = false;
    while (!this.eof()) {
      if (this.isEmbeddedStart()) {
        this.parseEmbedded();
        dynamic = true;
        continue;
      }
      if (this.startsWith(`__`)) {
        this.parsePreprocessing();
        dynamic = true;
        continue;
      }
      if (/[\w.-]/.test(this.peek())) {
        this.pos++;
        continue;
      }
      break;
    }
    const key = this.src.slice(keyStart, this.pos).trim();
    if (key === `` && !dynamic) {
      throw new ParseError(`Expected a message key.`, this.pos, 1);
    }
    node.key = { "value": key, "offset": keyStart, "length": this.pos - keyStart, "dynamic": dynamic };
    this.skipWs();
    if (this.peek() === `(`) {
      this.parseArgList(node);
    }
    this.skipWs();
    this.expect(`}`, `Expected '}' to close '#{'.`);
  }

  // 3-3. 인자 목록 (메시지·프래그먼트)
  parseArgList(node: ExpressionNodeType): void {
    this.pos++;
    node.argsOffset = this.pos;
    this.skipWs();
    if (this.consume(`)`)) {
      return;
    }
    while (true) {
      this.skipWs();
      const argStart = this.pos;
      let name = ``;
      const named = this.matchAt(NAMED_ARG_PATTERN);
      if (named) {
        name = named.replace(/\s*=$/, ``);
        this.pos += named.length;
        node.namedArgs = true;
      }
      this.parseConditional(`,)`);
      node.args.push({ "name": name, "offset": argStart, "length": this.pos - argStart });
      this.skipWs();
      if (this.consume(`,`)) {
        continue;
      }
      this.expect(`)`, `Expected ')' to close the argument list.`);
      return;
    }
  }

  // 3-4. 링크 본문
  parseLinkBody(node: ExpressionNodeType): void {
    const pathStart = this.pos;
    let dynamic = false;
    const variables: string[] = [];
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === `}` || ch === `(`) {
        break;
      }
      if (this.isEmbeddedStart()) {
        this.parseEmbedded();
        dynamic = true;
        continue;
      }
      if (this.startsWith(`__`)) {
        this.parsePreprocessing();
        dynamic = true;
        continue;
      }
      if (ch === `{`) {
        const end = this.src.indexOf(`}`, this.pos);
        if (end < 0) {
          throw new ParseError(`Unclosed path variable '{'.`, this.pos, 1);
        }
        variables.push(this.src.slice(this.pos + 1, end).trim());
        this.pos = end + 1;
        continue;
      }
      this.pos++;
    }
    node.path = { "value": this.src.slice(pathStart, this.pos).trim(), "offset": pathStart, "length": this.pos - pathStart, "dynamic": dynamic };
    node.pathVariables = variables;
    this.skipWs();
    if (this.peek() === `(`) {
      this.pos++;
      node.argsOffset = this.pos;
      while (true) {
        this.skipWs();
        const argStart = this.pos;
        const name = this.matchAt(PARAM_NAME_PATTERN);
        if (!name) {
          throw new ParseError(`Expected a parameter name in the link parameters.`, this.pos, 1);
        }
        this.pos += name.length;
        this.skipWs();
        this.expect(`=`, `Expected '=' after link parameter '${name}'.`);
        this.parseConditional(`,)`);
        node.args.push({ "name": name, "offset": argStart, "length": this.pos - argStart });
        node.namedArgs = true;
        this.skipWs();
        if (this.consume(`,`)) {
          continue;
        }
        this.expect(`)`, `Expected ')' to close the link parameters.`);
        break;
      }
    }
    this.skipWs();
    this.expect(`}`, `Expected '}' to close '@{'.`);
  }

  // 3-5. 프래그먼트 본문 (~{} 내부 또는 레거시 속성값)
  parseFragmentBody(node: ExpressionNodeType, braced: boolean): void {
    this.skipWs();
    const templateStart = this.pos;
    let dynamic = false;
    while (!this.eof()) {
      if (this.isEmbeddedStart()) {
        this.parseEmbedded();
        dynamic = true;
        continue;
      }
      if (this.startsWith(`__`)) {
        this.parsePreprocessing();
        dynamic = true;
        continue;
      }
      if (/[\w/.-]/.test(this.peek())) {
        this.pos++;
        continue;
      }
      break;
    }
    node.template = { "value": this.src.slice(templateStart, this.pos).trim(), "offset": templateStart, "length": this.pos - templateStart, "dynamic": dynamic };
    this.skipWs();
    if (this.consume(`::`)) {
      this.skipWs();
      const selectorStart = this.pos;
      let selectorDynamic = false;
      while (!this.eof()) {
        const ch = this.peek();
        if (ch === `(` || (braced && ch === `}`)) {
          break;
        }
        if (this.isEmbeddedStart()) {
          this.parseEmbedded();
          selectorDynamic = true;
          continue;
        }
        this.pos++;
      }
      node.selector = { "value": this.src.slice(selectorStart, this.pos).trim(), "offset": selectorStart, "length": this.pos - selectorStart, "dynamic": selectorDynamic };
      if (node.selector.value === ``) {
        throw new ParseError(`Expected a fragment selector after '::'.`, this.pos, 1);
      }
      this.skipWs();
      if (this.peek() === `(`) {
        this.parseArgList(node);
      }
    }
    else if (this.peek() === `(` && node.template.value !== ``) {
      this.parseArgList(node);
    }
    this.skipWs();
    if (braced) {
      this.expect(`}`, `Expected '}' to close '~{'.`);
    }
    else if (!this.eof()) {
      throw this.unexpected();
    }
  }

  // 4-1. SpEL 서브셋 (${} *{} 내부, sec:* 속성)
  parseSpel(stops: string, node: ExpressionNodeType): void {
    this.parseSpelTernary(stops, node);
    this.skipWs();
    if (!this.isStop(stops)) {
      throw this.unexpected();
    }
  }
  parseSpelTernary(stops: string, node: ExpressionNodeType): void {
    this.parseSpelOr(stops, node);
    while (true) {
      this.skipWs();
      if (this.consume(`?:`)) {
        this.parseSpelOr(stops, node);
        continue;
      }
      if (this.peek() === `?` && this.peek(1) !== `.` && this.peek(1) !== `[`) {
        this.pos++;
        this.parseSpelTernary(`${stops}:`, node);
        this.skipWs();
        this.expect(`:`, `Expected ':' in the conditional expression.`);
        this.parseSpelTernary(stops, node);
        return;
      }
      return;
    }
  }
  parseSpelOr(stops: string, node: ExpressionNodeType): void {
    this.parseSpelAnd(stops, node);
    while (true) {
      this.skipWs();
      if (this.consumeWord(`or`) || this.consume(`||`)) {
        this.parseSpelAnd(stops, node);
        continue;
      }
      return;
    }
  }
  parseSpelAnd(stops: string, node: ExpressionNodeType): void {
    this.parseSpelNot(stops, node);
    while (true) {
      this.skipWs();
      if (this.consumeWord(`and`) || this.consume(`&&`)) {
        this.parseSpelNot(stops, node);
        continue;
      }
      return;
    }
  }
  parseSpelNot(stops: string, node: ExpressionNodeType): void {
    this.skipWs();
    if (this.consumeWord(`not`) || (this.peek() === `!` && this.peek(1) !== `=` && this.consume(`!`))) {
      this.parseSpelNot(stops, node);
      return;
    }
    this.parseSpelRelational(stops, node);
  }
  parseSpelRelational(stops: string, node: ExpressionNodeType): void {
    this.parseSpelAdditive(stops, node);
    while (true) {
      this.skipWs();
      if (this.consumeAny(SYMBOL_RELATIONAL) || this.consumeAnyWord(SPEL_WORD_RELATIONAL)) {
        this.parseSpelAdditive(stops, node);
        continue;
      }
      return;
    }
  }
  parseSpelAdditive(stops: string, node: ExpressionNodeType): void {
    this.parseSpelMultiplicative(stops, node);
    while (true) {
      this.skipWs();
      if (this.consumeAny([`+`, `-`])) {
        this.parseSpelMultiplicative(stops, node);
        continue;
      }
      return;
    }
  }
  parseSpelMultiplicative(stops: string, node: ExpressionNodeType): void {
    this.parseSpelUnary(stops, node);
    while (true) {
      this.skipWs();
      if (this.consumeAny([`*`, `/`, `%`]) || this.consumeAnyWord([`div`, `mod`])) {
        this.parseSpelUnary(stops, node);
        continue;
      }
      return;
    }
  }
  parseSpelUnary(stops: string, node: ExpressionNodeType): void {
    this.skipWs();
    if ((this.peek() === `-` || this.peek() === `+`) && !/\d/.test(this.peek(1))) {
      this.pos++;
      this.parseSpelUnary(stops, node);
      return;
    }
    this.parseSpelPostfix(stops, node);
    this.skipWs();
    if (this.peek() === `^` && this.peek(1) !== `[`) {
      this.pos++;
      this.parseSpelUnary(stops, node);
    }
  }
  parseSpelPostfix(stops: string, node: ExpressionNodeType): void {
    const root = this.parseSpelPrimary(stops, node);
    const segments: ChainSegmentType[] = [];
    root && node.chains.push({ "root": root, "segments": segments });
    while (true) {
      this.skipWs();
      if (this.peek() === `.` && [`![`, `?[`, `^[`, `$[`].some((marker) => this.startsWith(`.${marker}`))) {
        this.pos++;
      }
      if (this.startsWith(`?.`) || this.peek() === `.`) {
        const safe = this.peek() === `?`;
        this.pos += safe ? 2 : 1;
        this.skipWs();
        const name = this.wordAt();
        if (!name) {
          throw new ParseError(`Expected a property or method name after '.'.`, this.pos, 1);
        }
        const nameOffset = this.pos;
        this.pos += name.length;
        this.skipWs();
        if (this.peek() === `(`) {
          this.parseSpelCallArgs(node);
          segments.push({ "kind": `call`, "name": name, "safe": safe, "offset": nameOffset, "length": name.length });
        }
        else {
          segments.push({ "kind": `property`, "name": name, "safe": safe, "offset": nameOffset, "length": name.length });
        }
        continue;
      }
      if (this.startsWith(`?[`) || this.startsWith(`![`) || this.startsWith(`^[`) || this.startsWith(`$[`)) {
        const marker = this.peek();
        const offset = this.pos;
        this.pos += 2;
        this.parseSpelTernary(`]`, node);
        this.skipWs();
        this.expect(`]`, `Expected ']' to close the selection.`);
        segments.push({ "kind": marker === `!` ? `projection` : `selection`, "name": ``, "safe": false, "offset": offset, "length": this.pos - offset });
        continue;
      }
      if (this.peek() === `[`) {
        const offset = this.pos;
        this.pos++;
        this.parseSpelTernary(`]`, node);
        this.skipWs();
        this.expect(`]`, `Expected ']' to close the index.`);
        segments.push({ "kind": `index`, "name": ``, "safe": false, "offset": offset, "length": this.pos - offset });
        continue;
      }
      break;
    }
  }
  parseSpelCallArgs(node: ExpressionNodeType): void {
    this.pos++;
    this.skipWs();
    if (this.consume(`)`)) {
      return;
    }
    while (true) {
      this.parseSpelTernary(`,)`, node);
      this.skipWs();
      if (this.consume(`,`)) {
        continue;
      }
      this.expect(`)`, `Expected ')' to close the call.`);
      return;
    }
  }
  parseSpelPrimary(stops: string, node: ExpressionNodeType): ChainRootType | undefined {
    this.skipWs();
    const start = this.pos;
    if (this.isStop(stops)) {
      throw new ParseError(`Expected an expression.`, this.pos, 1);
    }
    const ch = this.peek();
    if (ch === `'` || ch === `"`) {
      this.parseTextLiteral(ch);
      return { "kind": `literal`, "name": this.src.slice(start, this.pos), "offset": start, "length": this.pos - start };
    }
    const number = this.matchAt(NUMBER_PATTERN);
    if (number) {
      this.pos += number.length;
      return { "kind": `literal`, "name": number, "offset": start, "length": number.length };
    }
    if (this.isEmbeddedStart()) {
      this.parseEmbedded();
      return { "kind": `other`, "name": ``, "offset": start, "length": this.pos - start };
    }
    if (this.startsWith(`__`)) {
      this.parsePreprocessing();
      return { "kind": `other`, "name": ``, "offset": start, "length": this.pos - start };
    }
    if (ch === `(`) {
      this.pos++;
      this.parseSpelTernary(`)`, node);
      this.skipWs();
      this.expect(`)`, `Expected ')' to close the parenthesis.`);
      return { "kind": `other`, "name": ``, "offset": start, "length": this.pos - start };
    }
    if (ch === `{`) {
      this.parseSpelInlineCollection(node);
      return { "kind": `other`, "name": ``, "offset": start, "length": this.pos - start };
    }
    if (ch === `#`) {
      this.pos++;
      const name = this.wordAt();
      if (!name) {
        throw new ParseError(`Expected a utility object name after '#'.`, this.pos, 1);
      }
      this.pos += name.length;
      return { "kind": `utility`, "name": `#${name}`, "offset": start, "length": this.pos - start };
    }
    if (ch === `@`) {
      this.pos++;
      const name = this.wordAt();
      if (!name) {
        throw new ParseError(`Expected a bean name after '@'.`, this.pos, 1);
      }
      this.pos += name.length;
      return { "kind": `bean`, "name": `@${name}`, "offset": start, "length": this.pos - start };
    }
    const word = this.wordAt();
    if (!word) {
      throw this.unexpected();
    }
    if (word === `T`) {
      this.pos += 1;
      this.skipWs();
      if (this.peek() === `(`) {
        const close = this.src.indexOf(`)`, this.pos);
        if (close < 0) {
          throw new ParseError(`Expected ')' to close the type reference.`, this.pos, 1);
        }
        const typeName = this.src.slice(this.pos + 1, close).trim();
        this.pos = close + 1;
        return { "kind": `type`, "name": typeName, "offset": start, "length": this.pos - start };
      }
      return { "kind": `identifier`, "name": word, "offset": start, "length": word.length };
    }
    if (word === `new`) {
      this.pos += 3;
      this.skipWs();
      const typeName = this.matchAt(TYPE_NAME_PATTERN);
      if (!typeName) {
        throw new ParseError(`Expected a type name after 'new'.`, this.pos, 1);
      }
      this.pos += typeName.length;
      this.skipWs();
      if (this.peek() === `(`) {
        this.parseSpelCallArgs(node);
      }
      else if (this.peek() === `[`) {
        this.pos++;
        this.skipWs();
        this.peek() !== `]` && this.parseSpelTernary(`]`, node);
        this.skipWs();
        this.expect(`]`, `Expected ']' to close the array size.`);
      }
      return { "kind": `other`, "name": typeName.trim(), "offset": start, "length": this.pos - start };
    }
    if (word === `true` || word === `false` || word === `null`) {
      this.pos += word.length;
      return { "kind": `literal`, "name": word, "offset": start, "length": word.length };
    }
    if (SPEL_KEYWORDS.has(word)) {
      throw this.unexpected();
    }
    this.pos += word.length;
    this.skipWs();
    if (this.peek() === `(`) {
      this.parseSpelCallArgs(node);
      return { "kind": `call`, "name": word, "offset": start, "length": word.length };
    }
    return { "kind": `identifier`, "name": word, "offset": start, "length": word.length };
  }
  parseSpelInlineCollection(node: ExpressionNodeType): void {
    this.pos++;
    this.skipWs();
    if (this.consume(`}`)) {
      return;
    }
    while (true) {
      this.skipWs();
      if (this.consume(`:`)) {
        this.skipWs();
        this.expect(`}`, `Expected '}' to close the inline map.`);
        return;
      }
      this.parseSpelTernary(`,:}`, node);
      this.skipWs();
      if (this.consume(`:`)) {
        this.parseSpelTernary(`,}`, node);
        this.skipWs();
      }
      if (this.consume(`,`)) {
        continue;
      }
      this.expect(`}`, `Expected '}' to close the inline collection.`);
      return;
    }
  }
}

// 5. 노드 오프셋 이동 ---------------------------------------------------------------------
const shiftNode = (node: ExpressionNodeType, delta: number): ExpressionNodeType => ({
  ...node,
  "offset": node.offset + delta,
  "innerOffset": node.innerOffset + delta,
  "argsOffset": node.argsOffset < 0 ? -1 : node.argsOffset + delta,
  "chains": node.chains.map((chain) => ({
    "root": { ...chain.root, "offset": chain.root.offset + delta },
    "segments": chain.segments.map((segment) => ({ ...segment, "offset": segment.offset + delta })),
  })),
  "key": node.key ? { ...node.key, "offset": node.key.offset + delta } : undefined,
  "path": node.path ? { ...node.path, "offset": node.path.offset + delta } : undefined,
  "template": node.template ? { ...node.template, "offset": node.template.offset + delta } : undefined,
  "selector": node.selector ? { ...node.selector, "offset": node.selector.offset + delta } : undefined,
  "args": node.args.map((arg) => ({ ...arg, "offset": arg.offset + delta })),
});

// 6. 빈 파싱 결과 -----------------------------------------------------------------------
export const emptyParsedValue = (): ParsedValueType => ({ "errors": [], "expressions": [], "eachVars": [], "assignments": [], "fragmentParams": [] });

// 7. 속성 종류별 값 파싱 -------------------------------------------------------------------
export const parseAttributeValue = (value: string, kind: AttributeKindType, baseOffset = 0): ParsedValueType => {
  const scanner = new ExpressionScanner(value);
  const parsed = emptyParsedValue();
  const nodeCount = () => scanner.nodes.length;
  try {
    if (value.trim() === `` || kind === `plain`) {
      // 값 없음·자유 텍스트
    }
    else if (kind === `each`) {
      EACH_HEAD_PATTERN.lastIndex = 0;
      const head = EACH_HEAD_PATTERN.exec(value);
      if (head) {
        parsed.eachVars = [head[1], head[2]].filter((name): name is string => typeof name === `string`);
        scanner.pos = head[0].length;
      }
      const before = nodeCount();
      scanner.parseStandard(``);
      parsed.eachIterable = scanner.nodes[before];
    }
    else if (kind === `assignation`) {
      while (true) {
        scanner.skipWs();
        const nameStart = scanner.pos;
        const name = scanner.matchAt(PARAM_NAME_PATTERN);
        if (!name) {
          throw new ParseError(`Expected an assignment name (name=value).`, scanner.pos, 1);
        }
        scanner.pos += name.length;
        scanner.skipWs();
        scanner.expect(`=`, `Expected '=' after '${name}'.`);
        const before = nodeCount();
        scanner.parseConditional(`,`);
        parsed.assignments.push({ "name": name, "offset": nameStart, "expression": scanner.nodes[before] });
        scanner.skipWs();
        if (scanner.consume(`,`)) {
          continue;
        }
        if (!scanner.eof()) {
          throw scanner.unexpected();
        }
        break;
      }
    }
    else if (kind === `fragment-def`) {
      const matched = FRAGMENT_DEF_PATTERN.exec(value);
      if (matched) {
        parsed.fragmentName = matched[1];
        parsed.fragmentParams = (matched[2] ?? ``).split(`,`).map((param) => param.trim()).filter((param) => param.length > 0);
      }
    }
    else if (kind === `fragment-ref`) {
      scanner.skipWs();
      if (scanner.isEmbeddedStart() || scanner.peek() === `'` || scanner.peek() === `|`) {
        scanner.parseStandard(``);
      }
      else {
        const node: ExpressionNodeType = { "kind": `fragment`, "offset": scanner.pos, "length": 0, "inner": value, "innerOffset": scanner.pos, "chains": [], "pathVariables": [], "args": [], "namedArgs": false, "argsOffset": -1 };
        scanner.nodes.push(node);
        scanner.parseFragmentBody(node, false);
        node.length = scanner.pos - node.offset;
        node.inner = value.slice(node.innerOffset, scanner.pos);
      }
    }
    else if (kind === `case`) {
      if (value.trim() !== `*`) {
        scanner.parseStandard(``);
      }
    }
    else if (kind === `assert`) {
      while (true) {
        scanner.parseConditional(`,`);
        scanner.skipWs();
        if (scanner.consume(`,`)) {
          continue;
        }
        if (!scanner.eof()) {
          throw scanner.unexpected();
        }
        break;
      }
    }
    else if (kind === `spel`) {
      const node: ExpressionNodeType = { "kind": `variable`, "offset": 0, "length": value.length, "inner": value, "innerOffset": 0, "chains": [], "pathVariables": [], "args": [], "namedArgs": false, "argsOffset": -1 };
      scanner.nodes.push(node);
      scanner.parseSpel(``, node);
    }
    else {
      scanner.parseStandard(``);
    }
  }
  catch (error) {
    if (!(error instanceof ParseError)) {
      throw error;
    }
    parsed.errors.push({ "code": `thymeleaf-expression-syntax`, "message": error.message, "severity": `error`, "offset": baseOffset + error.offset, "length": Math.max(1, error.length) });
  }
  parsed.expressions = scanner.nodes.map((node) => (baseOffset === 0 ? node : shiftNode(node, baseOffset)));
  parsed.eachIterable = parsed.eachIterable ? parsed.expressions[scanner.nodes.indexOf(parsed.eachIterable)] : undefined;
  parsed.assignments = parsed.assignments.map((assignment) => ({ ...assignment, "offset": assignment.offset + baseOffset, "expression": assignment.expression ? parsed.expressions[scanner.nodes.indexOf(assignment.expression)] : undefined }));
  return parsed;
};

// 8. 오프셋 위치의 표현식 노드·체인 탐색 ------------------------------------------------------
export const findExpressionAt = (parsed: ParsedValueType, offset: number): ExpressionNodeType | undefined => {
  let best: ExpressionNodeType | undefined;
  for (const node of parsed.expressions) {
    if (offset >= node.offset && offset <= node.offset + node.length && (!best || node.length <= best.length)) {
      best = node;
    }
  }
  return best;
};
export const findChainAt = (node: ExpressionNodeType, offset: number): { chain: ExpressionChainType; segmentIndex: number } | undefined => {
  for (const chain of node.chains) {
    if (offset >= chain.root.offset && offset <= chain.root.offset + chain.root.length) {
      return { "chain": chain, "segmentIndex": -1 };
    }
    for (const [index, segment] of chain.segments.entries()) {
      if (offset >= segment.offset && offset <= segment.offset + segment.length) {
        return { "chain": chain, "segmentIndex": index };
      }
    }
  }
  return undefined;
};
export const toIssue = (message: string, offset: number, length = 1): ExpressionIssueType => ({ "code": `thymeleaf-expression-syntax`, "message": message, "severity": `error`, "offset": offset, "length": length });
