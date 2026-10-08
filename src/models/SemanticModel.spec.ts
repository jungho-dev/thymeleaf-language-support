import { describe, expect, test } from "bun:test";
import type { JavaTypeType, ModelAttributeType, SemanticIndexType, SemanticOptionsType } from "@exportTypes";
import { parseJavaFile } from "./JavaModel";
import { analyzeSemantics, elementTypeOf, parseTypeRef, resolveTypeRef } from "./SemanticModel";
import { buildScopes, parseTemplate } from "./ThymeleafModel";

const POJO = `package d;
import lombok.Data;
@Data public class User extends BaseEntity { private Long id; private String name; private Address address; private List<Role> roles; private Map<String, Integer> scores; public String getDisplayName() { return name; } }
record Address(String city) {}
public class BaseEntity { private LocalDateTime createdAt; public LocalDateTime getCreatedAt() { return createdAt; } }
public class Form { private String email; public String getEmail() { return email; } }
`;
const types = new Map<string, JavaTypeType>(parseJavaFile(POJO, `C:/d/User.java`).types.map((type) => [type.name, type]));

const attribute = (name: string, typeName?: string): ModelAttributeType => ({ "name": name, "typeName": typeName, "fsPath": `C:/c/HomeController.java`, "line": 1, "column": 1, "length": name.length, "offset": 0, "source": `addAttribute`, "methodName": `home` });
const buildIndex = (overrides: Partial<SemanticIndexType> = {}): SemanticIndexType => ({
  "modelContextFor": () => ({ "mapped": true, "dynamic": false, "attributes": new Map([[`user`, [attribute(`user`, `User`)]], [`users`, [attribute(`users`, `List<User>`)]], [`form`, [attribute(`form`, `Form`)]], [`untyped`, [attribute(`untyped`)]]]) }),
  "resolveJavaType": (name) => (types.has(name) ? { "type": types.get(name) as JavaTypeType, "fsPath": `C:/d/${name}.java` } : undefined),
  "hasMessages": () => true,
  "findMessages": (key) => (key === `home.welcome` ? [{ "key": key, "value": `Hi {0} {1}`, "fsPath": `m`, "locale": `default`, "line": 0, "column": 0, "placeholders": 2 }] : []),
  "hasLinks": () => true,
  "linkExists": (path) => path === `/users` || path === `/css/app.css`,
  "fragmentCatalog": (name) => (name === `fragments/footer` ? { "fragments": [{ "name": `copy`, "params": [`year`], "prefix": `th`, "tag": `footer`, "offset": 0, "length": 1, "elementIndex": 0 }], "tagNames": new Set([`footer`, `nav`]), "ids": new Set(), "refs": new Set([`slot`]) } : name === `components/datepicker` ? { "fragments": [{ "name": `datepicker`, "params": [], "prefix": `th`, "tag": `section`, "offset": 0, "length": 1, "elementIndex": 0 }], "tagNames": new Set([`section`]), "ids": new Set(), "refs": new Set() } : undefined),
  ...overrides,
});
const options: SemanticOptionsType = { "templateName": `home`, "modelValidation": true, "linkValidation": true, "messageValidation": true };
const codesOf = (html: string, index = buildIndex()): string[] => {
  const template = parseTemplate(html);
  return analyzeSemantics(template, buildScopes(template), index, options).diagnostics.map((item) => item.code);
};
const messagesOf = (html: string, index = buildIndex()): string[] => {
  const template = parseTemplate(html);
  return analyzeSemantics(template, buildScopes(template), index, options).diagnostics.map((item) => item.message);
};

// 1. 모델 변수·프로퍼티 ------------------------------------------------------------------------
describe(`model attributes and properties`, () => {
  test(`accepts known attributes, properties, getters, inherited and nested properties`, () => {
    expect(codesOf(`<p th:text="\${user.name} + \${user.displayName} + \${user.createdAt} + \${user.address.city} + \${user.getName()}"></p>`)).toEqual([]);
  });

  test(`reports unknown model attribute and unknown property`, () => {
    expect(codesOf(`<p th:text="\${missing}"></p>`)).toEqual([`thymeleaf-unknown-model-attribute`]);
    expect(messagesOf(`<p th:text="\${user.nmae}"></p>`)[0]).toContain(`Property 'nmae' does not exist on User`);
    expect(codesOf(`<p th:text="\${user.address.zip}"></p>`)).toEqual([`thymeleaf-unknown-property`]);
    expect(codesOf(`<p th:text="\${user.nope()}"></p>`)).toEqual([`thymeleaf-unknown-property`]);
  });

  test(`stays silent for open types, context objects, utilities, and unmapped templates`, () => {
    expect(codesOf(`<p th:text="\${untyped.anything.goes} + \${param.q} + \${#strings.trim(user.name)} + \${_csrf.token} + \${user.name.length()}"></p>`)).toEqual([]);
    const unmapped = buildIndex({ "modelContextFor": () => ({ "mapped": false, "dynamic": false, "attributes": new Map() }) });
    expect(codesOf(`<p th:text="\${whatever}"></p>`, unmapped)).toEqual([]);
    const dynamic = buildIndex({ "modelContextFor": () => ({ "mapped": true, "dynamic": true, "attributes": new Map() }) });
    expect(codesOf(`<p th:text="\${whatever}"></p>`, dynamic)).toEqual([]);
  });
});

// 2. 스코프 (each·with·stat·object·fragment) ---------------------------------------------------------
describe(`scopes`, () => {
  test(`propagates iteration element types and status properties`, () => {
    expect(codesOf(`<li th:each="u, st : \${users}"><span th:text="\${u.name} + \${st.index} + \${uStat.count}"></span></li>`)).toEqual([]);
    expect(codesOf(`<li th:each="u : \${users}" th:text="\${u.nmae}"></li>`)).toEqual([`thymeleaf-unknown-property`]);
    expect(codesOf(`<li th:each="u : \${users}"><b th:text="\${st.index}"></b></li>`)).toEqual([`thymeleaf-unknown-model-attribute`]);
    expect(codesOf(`<li th:each="u : \${users}"><b th:text="\${u.scores['a']} + \${uStat.nope}"></b></li>`)).toEqual([`thymeleaf-unknown-property`]);
  });

  test(`does not leak locals outside their element or into the iterable itself`, () => {
    expect(codesOf(`<li th:each="u : \${users}"></li><p th:text="\${u}"></p>`)).toEqual([`thymeleaf-unknown-model-attribute`]);
    expect(codesOf(`<li th:each="u : \${u}"></li>`)).toEqual([`thymeleaf-unknown-model-attribute`]);
  });

  test(`resolves th:with and th:object selections`, () => {
    expect(codesOf(`<div th:with="first=\${users[0]}"><span th:text="\${first.name}"></span></div>`)).toEqual([]);
    expect(codesOf(`<div th:with="first=\${users[0]}"><span th:text="\${first.nmae}"></span></div>`)).toEqual([`thymeleaf-unknown-property`]);
    expect(codesOf(`<form th:object="\${form}"><input th:field="*{email}"><span th:text="*{emial}"></span></form>`)).toEqual([`thymeleaf-unknown-property`]);
    expect(codesOf(`<span th:text="*{email}"></span>`)).toEqual([`thymeleaf-selection-without-object`]);
    expect(codesOf(`<div th:fragment="f(x)"><span th:text="*{email} + \${x.anything}"></span></div>`)).toEqual([]);
  });
});

// 3. 메시지·링크·프래그먼트 ------------------------------------------------------------------------
describe(`messages, links, fragments`, () => {
  test(`validates message keys and argument counts`, () => {
    expect(codesOf(`<p th:text="#{home.welcome(\${user.name}, 1)}"></p>`)).toEqual([]);
    expect(codesOf(`<p th:text="#{home.welcome}"></p>`)).toEqual([`thymeleaf-message-arity`]);
    expect(codesOf(`<p th:text="#{nope.key}"></p>`)).toEqual([`thymeleaf-unknown-message-key`]);
    expect(codesOf(`<p th:text="#{\${untyped}}"></p>`)).toEqual([]);
  });

  test(`validates static links only`, () => {
    expect(codesOf(`<a th:href="@{/users}">x</a><link th:href="@{/css/app.css}"><a th:href="@{https://x.y/z}">e</a><a th:href="@{\${untyped}}">d</a>`)).toEqual([]);
    expect(codesOf(`<a th:href="@{/missing}">x</a>`)).toEqual([`thymeleaf-unknown-link`]);
  });

  test(`validates fragment names and arities`, () => {
    expect(codesOf(`<div th:replace="~{fragments/footer :: copy(\${user.id})}"></div>`)).toEqual([]);
    expect(codesOf(`<div th:replace="~{fragments/footer :: copy}"></div>`)).toEqual([]);
    expect(codesOf(`<div th:replace="~{fragments/footer :: nav}"></div>`)).toEqual([]);
    expect(codesOf(`<div th:replace="~{fragments/footer :: nope}"></div>`)).toEqual([`thymeleaf-unknown-fragment`]);
    expect(codesOf(`<div th:replace="~{fragments/footer :: copy(1, 2)}"></div>`)).toEqual([`thymeleaf-fragment-arity`]);
    expect(codesOf(`<div th:replace="~{fragments/footer :: copy(owner=1)}"></div>`)).toEqual([`thymeleaf-fragment-arity`]);
    expect(codesOf(`<div th:fragment="local(a)"></div><div th:replace="~{:: local(1)}"></div><div th:replace="~{:: nope}"></div>`)).toEqual([`thymeleaf-unknown-fragment`]);
    expect(codesOf(`<div th:replace="~{unknown/tpl :: x}"></div>`)).toEqual([]);
  });

  test(`accepts th:ref markers and named arguments to parameterless fragments`, () => {
    expect(codesOf(`<th:block th:replace="~{fragments/footer :: copy(~{:: title-ref})}"><b th:ref="title-ref"></b></th:block>`)).toEqual([]);
    expect(codesOf(`<div th:replace="~{fragments/footer :: slot}"></div>`)).toEqual([]);
    expect(codesOf(`<div th:replace="~{components/datepicker :: datepicker(label='Day', span='92')}"></div>`)).toEqual([]);
    expect(codesOf(`<div th:replace="~{components/datepicker :: datepicker('Day')}"></div>`)).toEqual([`thymeleaf-fragment-arity`]);
  });
});

// 3-1. 선택적 모델 속성 -------------------------------------------------------
describe(`optional model attributes`, () => {
  test(`skips unknown roots guarded by elvis or safe navigation`, () => {
    expect(codesOf(`<title th:text="\${pageTitle} ?: 'Home'"></title>`)).toEqual([]);
    expect(codesOf(`<title th:text="\${pageTitle ?: 'Home'}"></title>`)).toEqual([]);
    expect(codesOf(`<title th:text="\${pageTitle?.trim()}"></title>`)).toEqual([]);
    expect(codesOf(`<title th:text="'Home' + \${pageTitle}"></title>`)).toEqual([`thymeleaf-unknown-model-attribute`]);
    expect(codesOf(`<title th:text="\${user.nmae} ?: 'x'"></title>`)).toEqual([`thymeleaf-unknown-property`]);
  });
});

// 4. 타입 유틸 -----------------------------------------------------------------------------
describe(`type helpers`, () => {
  test(`parses generics and arrays`, () => {
    expect(parseTypeRef(`java.util.Map<String, java.util.List<com.d.User>>`)).toEqual({ "name": `Map`, "args": [{ "name": `String`, "args": [], "array": false }, { "name": `List`, "args": [{ "name": `User`, "args": [], "array": false }], "array": false }], "array": false });
    expect(parseTypeRef(`User[]`)).toEqual({ "name": `User`, "args": [], "array": true });
  });

  test(`derives element types`, () => {
    const index = buildIndex();
    expect(elementTypeOf(resolveTypeRef(parseTypeRef(`List<User>`), index))?.name).toBe(`User`);
    expect(elementTypeOf(resolveTypeRef(parseTypeRef(`User[]`), index))?.name).toBe(`User`);
    expect(elementTypeOf(resolveTypeRef(parseTypeRef(`Map<String, User>`), index))?.name).toBe(`MapEntry`);
    expect(elementTypeOf(resolveTypeRef(parseTypeRef(`User`), index))).toBeUndefined();
  });
});
