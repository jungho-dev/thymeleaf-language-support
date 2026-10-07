import { describe, expect, test } from "bun:test";
import { analyzeTemplate, checkExpression, findAttributeAt, offsetToPosition, buildLineStarts, parseFragmentReference, parseTemplate, suggestAttributeName } from "./ThymeleafModel";

const codesOf = (html: string): string[] => analyzeTemplate(html).diagnostics.map((item) => item.code);

// 1. 템플릿 파싱 -----------------------------------------------------------------------------
describe(`parseTemplate`, () => {
  test(`collects dialect attributes with offsets and element index`, () => {
    const html = `<div class="a" th:text="\${user.name}" data-th-id="\${id}" sec:authorize="isAuthenticated()"></div>`;
    const template = parseTemplate(html);

    expect(template.isThymeleaf).toBe(true);
    expect(template.attributes.map((item) => `${item.prefix}:${item.name}`)).toEqual([`th:text`, `th:id`, `sec:authorize`]);
    expect(template.attributes[0].value).toBe(`\${user.name}`);
    expect(html.slice(template.attributes[0].nameOffset, template.attributes[0].nameOffset + 7)).toBe(`th:text`);
    expect(html.slice(template.attributes[0].valueOffset, template.attributes[0].valueOffset + 12)).toBe(`\${user.name}`);
    expect(template.attributes.every((item) => item.elementIndex === 0)).toBe(true);
  });

  test(`detects the th namespace, fragments, and parameters`, () => {
    const html = `<html xmlns:th="http://www.thymeleaf.org"><footer th:fragment="copy(year, owner)">x</footer><div layout:fragment="content"></div></html>`;
    const template = parseTemplate(html);

    expect(template.hasNamespace).toBe(true);
    expect(template.fragments.map((item) => item.name)).toEqual([`copy`, `content`]);
    expect(template.fragments[0].params).toEqual([`year`, `owner`]);
    expect(template.fragments[0].tag).toBe(`footer`);
    expect(template.fragments[1].prefix).toBe(`layout`);
  });

  test(`skips comments and CDATA but parses prototype-only comments`, () => {
    const html = `<!-- <p th:text="\${skipped}"></p> --><!--/* <p th:if="\${hidden}"></p> */--><!--/*/ <p th:text="\${shown}"></p> /*/--><![CDATA[ th:text="x" ]]>`;
    const template = parseTemplate(html);

    expect(template.attributes.map((item) => item.value)).toEqual([`\${shown}`]);
  });

  test(`collects text inlines and script inlines only in javascript mode`, () => {
    const html = `<p>Hello [[\${name}]] and [(\${raw})]</p><script>var a = [[1, 2]];</script><script th:inline="javascript">var b = /*[[\${b}]]*/ null;</script>`;
    const template = parseTemplate(html);

    expect(template.inlines.map((item) => `${item.kind}:${item.content}:${item.scriptMode}`)).toEqual([`escaped:\${name}:false`, `unescaped:\${raw}:false`, `escaped:\${b}:true`]);
  });

  test(`marks unclosed inlines and unterminated attribute quotes`, () => {
    const template = parseTemplate(`<p>[[\${open}</p><div th:text="\${x}>`);

    expect(template.inlines[0].closed).toBe(false);
    expect(template.attributes).toHaveLength(1);
  });

  test(`returns isThymeleaf=false for plain HTML`, () => {
    expect(parseTemplate(`<div class="x">[[not thymeleaf]]</div>`).isThymeleaf).toBe(false);
  });
});

// 2. 표현식 검사 -----------------------------------------------------------------------------
describe(`checkExpression`, () => {
  test(`accepts valid standard expressions`, () => {
    const samples = [
      `\${user.name}`,
      `*{name}`,
      `#{home.welcome(\${user.name})}`,
      `@{/order/{id}/details(id=\${o.id}, action='show')}`,
      `~{fragments/footer :: copy}`,
      `|Hello \${name}, it's \${day}|`,
      `\${#strings.isEmpty(x) ? 'a' : 'b'}`,
      `\${a} and \${b} or not \${c}`,
      `\${__\${inner}__}`,
      `\${list[0].name}`,
      `item, stat : \${items}`,
      `\${a || b}`,
      `\${'it\\'s'}`,
      `\${{1, 2}}`,
    ];
    for (const sample of samples) {
      expect(checkExpression(sample)).toEqual([]);
    }
  });

  test(`reports unclosed expression with its offset`, () => {
    const issues = checkExpression(`\${user.name`);

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe(`thymeleaf-unclosed-expression`);
    expect(issues[0].offset).toBe(0);
  });

  test(`reports unclosed string, unexpected closer, and mismatched bracket`, () => {
    expect(checkExpression(`\${'abc}`)[0].code).toBe(`thymeleaf-unclosed-string`);
    expect(checkExpression(`\${a}}`).map((item) => item.code)).toEqual([`thymeleaf-unexpected-closing`]);
    expect(checkExpression(`\${a]}`).map((item) => item.code)).toEqual([`thymeleaf-mismatched-bracket`]);
    expect(checkExpression(`\${fn(a}`).map((item) => [item.code, item.offset])).toEqual([[`thymeleaf-unclosed-expression`, 4]]);
  });

  test(`reports empty, nested, and literal substitution problems`, () => {
    expect(checkExpression(`\${}`).map((item) => item.code)).toEqual([`thymeleaf-empty-expression`]);
    expect(checkExpression(`\${a + \${b}}`).map((item) => item.code)).toEqual([`thymeleaf-nested-expression`]);
    expect(checkExpression(`|Hello \${name}`).map((item) => item.code)).toEqual([`thymeleaf-unclosed-literal-substitution`]);
  });

  test(`validates message keys`, () => {
    expect(checkExpression(`#{home welcome}`).map((item) => item.code)).toEqual([`thymeleaf-invalid-message-key`]);
    expect(checkExpression(`#{\${dynamicKey}}`)).toEqual([]);
    expect(checkExpression(`#{__\${k}__.title}`)).toEqual([]);
  });
});

// 3. 프래그먼트 참조 -------------------------------------------------------------------------
describe(`parseFragmentReference`, () => {
  test(`parses fragment expression forms`, () => {
    expect(parseFragmentReference(`~{fragments/footer :: copy}`)).toEqual({ "template": `fragments/footer`, "selector": `copy`, "dynamic": false });
    expect(parseFragmentReference(`fragments/footer :: #main`)).toEqual({ "template": `fragments/footer`, "selector": `#main`, "dynamic": false });
    expect(parseFragmentReference(`~{layouts/default}`)).toEqual({ "template": `layouts/default`, "selector": ``, "dynamic": false });
    expect(parseFragmentReference(`~{:: copy}`)).toEqual({ "template": ``, "selector": `copy`, "dynamic": false });
    expect(parseFragmentReference(`this :: copy`)).toEqual({ "template": ``, "selector": `copy`, "dynamic": false });
  });

  test(`flags dynamic references`, () => {
    expect(parseFragmentReference(`~{\${tpl} :: frag}`)?.dynamic).toBe(true);
    expect(parseFragmentReference(``)).toBeUndefined();
  });
});

// 4. 진단 ----------------------------------------------------------------------------------
describe(`analyzeTemplate`, () => {
  test(`reports nothing for a valid template`, () => {
    const html = `<html xmlns:th="http://www.thymeleaf.org"><body>
<div th:each="item, stat : \${items}" th:classappend="\${stat.odd} ? 'odd'">
  <span th:text="\${item.name}">name</span>
  <a th:href="@{/items/{id}(id=\${item.id})}" th:title="#{item.link}">link</a>
  <th:block th:if="\${item.active}"><p th:utext="\${item.html}"></p></th:block>
</div>
<div th:replace="~{fragments/footer :: copy}"></div>
<p>Total: [[\${#lists.size(items)}]]</p>
<script th:inline="javascript">const items = /*[[\${items}]]*/ [];</script>
</body></html>`;
    const codes = codesOf(html);

    expect(codes).toEqual([`thymeleaf-unescaped-text`]);
  });

  test(`reports nothing for plain HTML without Thymeleaf markers`, () => {
    expect(codesOf(`<div class="a">[[x</div>`)).toEqual([]);
  });

  test(`reports expression syntax errors with document positions`, () => {
    const html = `<div>\n  <p th:text="\${user.name"></p>\n</div>`;
    const diagnostics = analyzeTemplate(html).diagnostics;

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe(`thymeleaf-unclosed-expression`);
    expect(diagnostics[0].line).toBe(1);
    expect(diagnostics[0].column).toBe(14);
  });

  test(`reports attribute-level problems`, () => {
    const html = `<div th:each="\${items}" th:inline="json" th:remove="everything" th:fragment="a b" th:with="x" th:object="*{obj}" th:txt="\${a}" th:include="x :: y" th:text="a" th:text="b" th:if th:unless=""></div>`;
    const codes = codesOf(html);

    expect(codes).toContain(`thymeleaf-invalid-each`);
    expect(codes).toContain(`thymeleaf-invalid-inline`);
    expect(codes).toContain(`thymeleaf-invalid-remove`);
    expect(codes).toContain(`thymeleaf-invalid-fragment`);
    expect(codes).toContain(`thymeleaf-invalid-assignation`);
    expect(codes).toContain(`thymeleaf-object-expression`);
    expect(codes).toContain(`thymeleaf-unknown-attribute`);
    expect(codes).toContain(`thymeleaf-deprecated-attribute`);
    expect(codes).toContain(`thymeleaf-duplicate-attribute`);
    expect(codes).toContain(`thymeleaf-missing-value`);
    expect(codes).toContain(`thymeleaf-empty-value`);
  });

  test(`suggests a correction for a misspelled attribute`, () => {
    const diagnostics = analyzeTemplate(`<p th:txet="\${a}"></p>`).diagnostics;

    expect(diagnostics[0].code).toBe(`thymeleaf-unknown-attribute`);
    expect(diagnostics[0].severity).toBe(`warning`);
    expect(diagnostics[0].message).toContain(`th:text`);
  });

  test(`accepts passthrough, HTML setter, and configured custom attributes`, () => {
    const html = `<p th:data-id="\${a}" th:aria-label="\${b}" th:onclick="\${c}" th:placeholder="\${d}" th:custom="\${e}"></p>`;

    expect(codesOf(html)).toEqual([`thymeleaf-unknown-attribute`]);
    expect(analyzeTemplate(html, { "additionalAttributes": [`custom`] }).diagnostics).toEqual([]);
  });

  test(`reports unclosed and broken inline expressions`, () => {
    expect(codesOf(`<p th:text="x">[[\${a}</p>`)).toEqual([`thymeleaf-unclosed-inline`]);
    expect(codesOf(`<p th:text="x">[[\${a]]</p>`)).toEqual([`thymeleaf-unclosed-expression`]);
    expect(codesOf(`<p th:text="x"></p><script th:inline="javascript">var a = [[1, 2]];</script>`)).toEqual([]);
  });
});

// 5. 보조 함수 -------------------------------------------------------------------------------
describe(`helpers`, () => {
  test(`offsetToPosition maps offsets across lines`, () => {
    const lineStarts = buildLineStarts(`ab\ncd\n\nef`);

    expect(offsetToPosition(lineStarts, 0)).toEqual({ "line": 0, "column": 0 });
    expect(offsetToPosition(lineStarts, 4)).toEqual({ "line": 1, "column": 1 });
    expect(offsetToPosition(lineStarts, 7)).toEqual({ "line": 3, "column": 0 });
  });

  test(`suggestAttributeName uses a bounded edit distance`, () => {
    expect(suggestAttributeName(`txet`)).toBe(`text`);
    expect(suggestAttributeName(`eahc`)).toBe(`each`);
    expect(suggestAttributeName(`zzzzzz`)).toBeUndefined();
    expect(suggestAttributeName(`ab`)).toBeUndefined();
  });

  test(`findAttributeAt locates the attribute spanning an offset`, () => {
    const html = `<div th:replace="~{f :: c}" th:text="x"></div>`;
    const template = parseTemplate(html);

    expect(findAttributeAt(template, html.indexOf(`::`))?.name).toBe(`replace`);
    expect(findAttributeAt(template, html.indexOf(`th:text`) + 2)?.name).toBe(`text`);
    expect(findAttributeAt(template, 1)).toBeUndefined();
  });
});
