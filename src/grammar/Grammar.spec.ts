import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as oniguruma from "vscode-oniguruma";
import * as vsctm from "vscode-textmate";

const ROOT = path.resolve(import.meta.dir, `../..`);
const GRAMMAR_FILES: Readonly<Record<string, string>> = {
  "text.html.basic": path.join(ROOT, `src/assets/fixtures/html.tmLanguage.json`),
  "text.html.derivative": path.join(ROOT, `src/assets/fixtures/html-derivative.tmLanguage.json`),
  "thymeleaf.injection": path.join(ROOT, `syntaxes/thymeleaf.injection.tmLanguage.json`),
};

interface TokenType {
  text: string;
  scopes: string[];
}

let grammar: vsctm.IGrammar;

// 1. 레지스트리 준비 (실제 VS Code HTML 문법 + 주입 문법) ------------------------------------
beforeAll(async () => {
  const wasmPath = path.join(ROOT, `node_modules/vscode-oniguruma/release/onig.wasm`);
  const wasmBinary = readFileSync(wasmPath);
  await oniguruma.loadWASM(wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength));
  const registry = new vsctm.Registry({
    "onigLib": Promise.resolve({
      "createOnigScanner": (patterns: string[]) => new oniguruma.OnigScanner(patterns),
      "createOnigString": (value: string) => new oniguruma.OnigString(value),
    }),
    "loadGrammar": async (scopeName: string) => {
      const file = GRAMMAR_FILES[scopeName];
      return file ? vsctm.parseRawGrammar(readFileSync(file, `utf8`), file) : null;
    },
    "getInjections": (scopeName: string) => (scopeName.startsWith(`text.html`) ? [`thymeleaf.injection`] : undefined),
  });
  const loaded = await registry.loadGrammar(`text.html.derivative`);
  if (!loaded) {
    throw new Error(`html grammar failed to load`);
  }
  grammar = loaded;
});

// 2. 토큰화 헬퍼 -----------------------------------------------------------------------------
const tokenize = (lines: string[]): TokenType[][] => {
  let ruleStack = vsctm.INITIAL;
  return lines.map((line) => {
    const lineTokens = grammar.tokenizeLine(line, ruleStack);
    ruleStack = lineTokens.ruleStack;
    return lineTokens.tokens.map((token) => ({ "text": line.slice(token.startIndex, token.endIndex), "scopes": token.scopes }));
  });
};
const scopesOf = (tokens: TokenType[], text: string): string[] => {
  const found = tokens.find((token) => token.text === text);
  if (!found) {
    throw new Error(`token '${text}' not found in: ${tokens.map((token) => JSON.stringify(token.text)).join(` `)}`);
  }
  return found.scopes;
};
const hasScope = (tokens: TokenType[], text: string, scope: string): boolean => scopesOf(tokens, text).some((entry) => entry === scope || entry.startsWith(`${scope}.`));

// 3. 속성 하이라이트 -------------------------------------------------------------------------
describe(`dialect attributes`, () => {
  test(`tokenizes th:text with a variable expression and closes the tag normally`, () => {
    const [tokens] = tokenize([`<div th:text="\${user.name}">`]);

    expect(hasScope(tokens, `th:`, `entity.other.attribute-name.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `text`, `entity.other.attribute-name.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `\${`, `punctuation.definition.template-expression.begin.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `user`, `variable.other.readwrite.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `name`, `variable.other.property.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `}`, `punctuation.definition.template-expression.end.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `>`, `punctuation.definition.tag.end.html`)).toBe(true);
    expect(scopesOf(tokens, `user`)).toContain(`meta.template.expression.variable.thymeleaf`);
  });

  test(`keeps plain HTML attributes on the host grammar`, () => {
    const [tokens] = tokenize([`<div class="a" th:class="\${c}" id="x">`]);

    expect(hasScope(tokens, `class`, `entity.other.attribute-name.thymeleaf`)).toBe(false);
    expect(hasScope(tokens, `class`, `entity.other.attribute-name.html`)).toBe(true);
    expect(hasScope(tokens, `id`, `entity.other.attribute-name.html`)).toBe(true);
    expect(hasScope(tokens, `c`, `variable.other.readwrite.thymeleaf`)).toBe(true);
  });

  test(`supports data-th-*, single quotes, sec:, and layout: prefixes`, () => {
    const [tokens] = tokenize([`<div data-th-text='\${a}' sec:authorize="hasRole('ADMIN')" layout:decorate="~{layouts/main}">`]);

    expect(hasScope(tokens, `data-th-`, `entity.other.attribute-name.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `sec:`, `entity.other.attribute-name.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `layout:`, `entity.other.attribute-name.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `a`, `variable.other.readwrite.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `layouts/main`, `entity.name.fragment.thymeleaf`)).toBe(true);
  });

  test(`keeps hyphenated tokens whole and quotes inside the string scope`, () => {
    const [tokens] = tokenize([`<div th:class="col-md-6" th:ref="title-ref-1" th:text="true">`]);

    expect(hasScope(tokens, `col-md-6`, `string.unquoted.token.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `title-ref-1`, `string.unquoted.token.thymeleaf`)).toBe(true);
    expect(tokens.some((token) => token.scopes.includes(`constant.numeric.thymeleaf`))).toBe(false);
    expect(hasScope(tokens, `true`, `constant.language.thymeleaf`)).toBe(true);
    expect(tokens.filter((token) => token.text === `"`).every((token) => token.scopes.includes(`string.quoted.double.html`))).toBe(true);
  });

  test(`does not claim unrelated namespaced attributes`, () => {
    const [tokens] = tokenize([`<svg xlink:href="#a" xmlns:th="http://www.thymeleaf.org">`]);

    expect(tokens.some((token) => token.scopes.some((scope) => scope.endsWith(`.thymeleaf`)))).toBe(false);
  });
});

// 4. 표현식 종류별 하이라이트 --------------------------------------------------------------------
describe(`expression kinds`, () => {
  test(`link expression with path variable and parameters`, () => {
    const [tokens] = tokenize([`<a th:href="@{/users/{id}/edit(id=\${u.id})}">`]);

    expect(hasScope(tokens, `/users/`, `string.other.link.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `{id}`, `variable.other.path-variable.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `id`, `variable.parameter.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `u`, `variable.other.readwrite.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `>`, `punctuation.definition.tag.end.html`)).toBe(true);
  });

  test(`message expression key and nested parameter`, () => {
    const [tokens] = tokenize([`<p th:text="#{home.welcome(\${name})}">`]);

    expect(hasScope(tokens, `home.welcome`, `support.constant.message-key.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `name`, `variable.other.readwrite.thymeleaf`)).toBe(true);
  });

  test(`fragment expression with selector operator`, () => {
    const [tokens] = tokenize([`<div th:replace="~{fragments/footer :: copy}">`]);

    expect(hasScope(tokens, `fragments/footer`, `entity.name.fragment.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `::`, `keyword.operator.fragment-selector.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `copy`, `entity.name.fragment.thymeleaf`)).toBe(true);
  });

  test(`literal substitution, operators, utilities, and literals`, () => {
    const [tokens] = tokenize([`<span th:text="|Hi \${name}|" th:if="\${#strings.isEmpty(x)} and \${n} gt 10 or \${ok} == true">`]);

    expect(hasScope(tokens, `Hi `, `string.quoted.other.literal-substitution.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `#strings`, `support.class.utility.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `isEmpty`, `entity.name.function.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `and`, `keyword.operator.word.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `gt`, `keyword.operator.word.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `10`, `constant.numeric.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `true`, `constant.language.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `==`, `keyword.operator.thymeleaf`)).toBe(true);
  });

  test(`string literal inside an expression`, () => {
    const [tokens] = tokenize([`<td th:class="\${stat.odd} ? 'odd' : 'even'">`]);

    expect(hasScope(tokens, `'`, `string.quoted.single.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `even`, `string.quoted.single.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `?`, `keyword.operator.thymeleaf`)).toBe(true);
  });
});

// 5. 텍스트 인라인·주석 ----------------------------------------------------------------------
describe(`inline and comments`, () => {
  test(`escaped and unescaped inline expressions in text`, () => {
    const [tokens] = tokenize([`<p>Hello [[\${user.name}]] and [(\${raw})]!</p>`]);

    expect(hasScope(tokens, `[[`, `punctuation.definition.template-expression.begin.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `]]`, `punctuation.definition.template-expression.end.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `[(`, `punctuation.definition.template-expression.begin.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `raw`, `variable.other.readwrite.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `</`, `punctuation.definition.tag.begin.html`)).toBe(true);
  });

  test(`inline expression inside a javascript block comment`, () => {
    const [, tokens] = tokenize([`<script th:inline="javascript">`, `var x = /*[[\${x}]]*/ 'y';`]);

    expect(hasScope(tokens, `[[`, `punctuation.definition.template-expression.begin.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `x`, `variable.other.readwrite.thymeleaf`)).toBe(true);
    expect(hasScope(tokens, `*/`, `comment.block.js`)).toBe(true);
    expect(hasScope(tokens, ` 'y';`, `source.js`)).toBe(true);
  });

  test(`parser-level comment is a comment, prototype-only comment keeps markup`, () => {
    const [parserTokens] = tokenize([`<!--/* <p th:text="\${a}"></p> */--><b>x</b>`]);
    const [protoTokens] = tokenize([`<!--/*/ <p th:text="\${a}"></p> /*/-->`]);

    expect(hasScope(parserTokens, `<!--/*`, `comment.block.parser-level.thymeleaf`)).toBe(true);
    expect(parserTokens.some((token) => token.text === `a` && token.scopes.includes(`variable.other.readwrite.thymeleaf`))).toBe(false);
    expect(hasScope(parserTokens, `b`, `entity.name.tag.html`)).toBe(true);
    expect(hasScope(protoTokens, `a`, `variable.other.readwrite.thymeleaf`)).toBe(true);
    expect(hasScope(protoTokens, `/*/-->`, `punctuation.definition.comment.prototype-only.thymeleaf`)).toBe(true);
  });

  test(`plain html comments stay comments`, () => {
    const [tokens] = tokenize([`<!-- <p th:text="\${a}"></p> -->`]);

    expect(tokens.every((token) => token.scopes.includes(`comment.block.html`))).toBe(true);
    expect(tokens.some((token) => token.scopes.includes(`variable.other.readwrite.thymeleaf`))).toBe(false);
  });
});

// 6. 다중 라인 상태 --------------------------------------------------------------------------
describe(`multi-line state`, () => {
  test(`attribute value spanning lines resumes and terminates`, () => {
    const [first, second, third] = tokenize([`<div th:text="\${a}`, `  + \${b}"`, `  class="c">`]);

    expect(hasScope(first, `a`, `variable.other.readwrite.thymeleaf`)).toBe(true);
    expect(hasScope(second, `b`, `variable.other.readwrite.thymeleaf`)).toBe(true);
    expect(hasScope(second, `"`, `punctuation.definition.string.end.html`)).toBe(true);
    expect(hasScope(third, `class`, `entity.other.attribute-name.html`)).toBe(true);
    expect(hasScope(third, `>`, `punctuation.definition.tag.end.html`)).toBe(true);
  });
});
