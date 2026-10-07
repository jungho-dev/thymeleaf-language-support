import { describe, expect, test } from "bun:test";
import { findChainAt, findExpressionAt, parseAttributeValue } from "./ExpressionParser";

const errorsOf = (value: string, kind: Parameters<typeof parseAttributeValue>[1] = `expression`): string[] => parseAttributeValue(value, kind).errors.map((issue) => issue.message);

// 1. 유효 표현식 -----------------------------------------------------------------------------
describe(`valid expressions`, () => {
  test(`accepts standard expression forms without errors`, () => {
    const samples = [
      `\${user.name}`,
      `*{name}`,
      `#{home.welcome(\${user.name})}`,
      `#{\${dynamicKey}}`,
      `@{/order/{id}/details(id=\${o.id}, action='show')}`,
      `@{\${url}}`,
      `@{~/static/app.css}`,
      `~{fragments/footer :: copy}`,
      `~{fragments/footer :: copy(\${a}, 'b')}`,
      `~{fragments/footer :: copy(year=\${y})}`,
      `~{:: #main}`,
      `~{\${tpl} :: frag}`,
      `|Hello \${name}, it's \${day}|`,
      `\${#strings.isEmpty(x) ? 'a' : 'b'}`,
      `\${a} and \${b} or not \${c}`,
      `\${__\${inner}__}`,
      `\${list[0].name}`,
      `\${a || b}`,
      `\${'it\\'s'}`,
      `\${{1, 2}}`,
      `\${{'a': 1, 'b': 2}}`,
      `\${stat.odd} ? 'odd' : 'even'`,
      `\${stat.odd} ? 'odd'`,
      `\${value} ?: 'default'`,
      `'Hello ' + \${name} + '!'`,
      `\${count} gt 10 and \${count} lt 100`,
      `\${a} == \${b}`,
      `\${price * 1.1}`,
      `\${user?.address?.city}`,
      `\${users.![name]}`,
      `\${users.?[active]}`,
      `\${T(java.lang.Math).max(1, 2)}`,
      `\${new java.util.Date()}`,
      `\${@myBean.compute(3)}`,
      `\${#authorization.expression('hasRole(''ADMIN'')')}`,
      `\${param.page != null ? param.page[0] : 1}`,
      `\${user.age gt 18 and user.active}`,
      `\${a instanceof T(String)}`,
      `\${name matches '[a-z]+'}`,
      `\${x} - \${y}`,
      `-\${x}`,
      `!\${flag}`,
      `form-control`,
      `all-but-first`,
      `\${session.user.name}`,
      `\${#dates.format(now, 'yyyy-MM-dd')}`,
      `\${items.size()} == 0`,
      `(\${a} or \${b}) and \${c}`,
      `#{msg.key}`,
      `__#{\${lang}.title}__`,
    ];
    for (const sample of samples) {
      expect({ sample, "errors": errorsOf(sample) }).toEqual({ sample, "errors": [] });
    }
  });

  test(`accepts kind specific syntaxes`, () => {
    expect(errorsOf(`item, stat : \${items}`, `each`)).toEqual([]);
    expect(errorsOf(`item : \${#numbers.sequence(1, 3)}`, `each`)).toEqual([]);
    expect(errorsOf(`a=\${b}, data-x=\${c}, title=#{t}`, `assignation`)).toEqual([]);
    expect(errorsOf(`fragments/footer :: copy`, `fragment-ref`)).toEqual([]);
    expect(errorsOf(`~{fragments/footer :: copy}`, `fragment-ref`)).toEqual([]);
    expect(errorsOf(`:: copy`, `fragment-ref`)).toEqual([]);
    expect(errorsOf(`\${tpl}`, `fragment-ref`)).toEqual([]);
    expect(errorsOf(`*`, `case`)).toEqual([]);
    expect(errorsOf(`'admin'`, `case`)).toEqual([]);
    expect(errorsOf(`\${a} gt 0, \${b} lt 10`, `assert`)).toEqual([]);
    expect(errorsOf(`hasRole('ADMIN') and hasAuthority('X')`, `spel`)).toEqual([]);
    expect(errorsOf(`isAuthenticated()`, `spel`)).toEqual([]);
    expect(errorsOf(`principal.username`, `spel`)).toEqual([]);
    expect(errorsOf(`anything goes here`, `plain`)).toEqual([]);
  });
});

// 2. 구문 오류 -------------------------------------------------------------------------------
describe(`syntax errors`, () => {
  test(`reports missing operators and unquoted text`, () => {
    expect(errorsOf(`Hello World`)[0]).toContain(`Unexpected token 'World'`);
    expect(errorsOf(`\${a} \${b}`)[0]).toContain(`Unexpected '$'`);
    expect(errorsOf(`\${a} +`)[0]).toContain(`Expected an expression`);
  });

  test(`reports SpEL problems with offsets`, () => {
    const dangling = parseAttributeValue(`\${user.}`, `expression`);
    expect(dangling.errors[0].message).toContain(`Expected a property or method name`);
    expect(dangling.errors[0].offset).toBe(7);
    expect(errorsOf(`\${a ? b}`)[0]).toContain(`Expected ':'`);
    expect(errorsOf(`\${fn(a,)}`)[0]).toContain(`Expected an expression`);
    expect(errorsOf(`\${a b}`)[0]).toContain(`Unexpected token 'b'`);
    expect(errorsOf(`\${and}`)[0]).toContain(`Unexpected token 'and'`);
  });

  test(`reports link and fragment problems`, () => {
    expect(errorsOf(`@{/x(id)}`)[0]).toContain(`Expected '='`);
    expect(errorsOf(`~{tpl ::}`)[0]).toContain(`Expected a fragment selector`);
    expect(errorsOf(`#{}`)[0]).toContain(`Expected a message key`);
  });

  test(`reports kind specific problems`, () => {
    expect(errorsOf(`a, b`, `assignation`)[0]).toContain(`Expected '='`);
    expect(errorsOf(`\${a} \${b}`, `assert`)[0]).toContain(`Unexpected`);
    expect(errorsOf(`hasRole('X') extra`, `spel`)[0]).toContain(`Unexpected token 'extra'`);
  });
});

// 3. AST 추출 --------------------------------------------------------------------------------
describe(`ast extraction`, () => {
  test(`extracts chains with roots and segments`, () => {
    const parsed = parseAttributeValue(`\${user.address.city} + \${#strings.toUpperCase(user.name)}`, `expression`);
    const [first, second] = parsed.expressions;

    expect(first.kind).toBe(`variable`);
    expect(first.chains[0].root).toMatchObject({ "kind": `identifier`, "name": `user`, "offset": 2 });
    expect(first.chains[0].segments.map((segment) => segment.name)).toEqual([`address`, `city`]);
    expect(second.chains[0].root).toMatchObject({ "kind": `utility`, "name": `#strings` });
    expect(second.chains[0].segments[0]).toMatchObject({ "kind": `call`, "name": `toUpperCase` });
    expect(second.chains[1].root.name).toBe(`user`);
  });

  test(`extracts message key, link path, fragment parts, and arguments`, () => {
    const message = parseAttributeValue(`#{home.welcome(\${name}, 3)}`, `expression`).expressions[0];
    const link = parseAttributeValue(`@{/users/{id}/edit(id=\${u.id}, tab='x')}`, `expression`).expressions[0];
    const fragment = parseAttributeValue(`~{fragments/footer :: copy(\${year}, owner='me')}`, `expression`).expressions[0];

    expect(message.key).toMatchObject({ "value": `home.welcome`, "dynamic": false });
    expect(message.args).toHaveLength(2);
    expect(link.path).toMatchObject({ "value": `/users/{id}/edit`, "dynamic": false });
    expect(link.pathVariables).toEqual([`id`]);
    expect(link.args.map((arg) => arg.name)).toEqual([`id`, `tab`]);
    expect(fragment.template?.value).toBe(`fragments/footer`);
    expect(fragment.selector?.value).toBe(`copy`);
    expect(fragment.args.map((arg) => arg.name)).toEqual([``, `owner`]);
    expect(fragment.namedArgs).toBe(true);
  });

  test(`extracts each variables, assignments, and fragment definitions`, () => {
    const each = parseAttributeValue(`item, stat : \${items}`, `each`);
    const assign = parseAttributeValue(`a=\${b}, c='x'`, `assignation`);
    const def = parseAttributeValue(`copy(year, owner)`, `fragment-def`);
    const legacy = parseAttributeValue(`fragments/footer :: copy`, `fragment-ref`);

    expect(each.eachVars).toEqual([`item`, `stat`]);
    expect(each.eachIterable?.chains[0].root.name).toBe(`items`);
    expect(assign.assignments.map((entry) => [entry.name, entry.expression?.kind])).toEqual([[`a`, `variable`], [`c`, undefined]]);
    expect(def.fragmentName).toBe(`copy`);
    expect(def.fragmentParams).toEqual([`year`, `owner`]);
    expect(legacy.expressions[0]).toMatchObject({ "kind": `fragment`, "template": { "value": `fragments/footer` }, "selector": { "value": `copy` } });
  });

  test(`applies base offsets and finds nodes by offset`, () => {
    const parsed = parseAttributeValue(`\${user.name}`, `expression`, 100);
    const node = findExpressionAt(parsed, 105);

    expect(parsed.expressions[0].offset).toBe(100);
    expect(node).toBeDefined();
    expect(findChainAt(parsed.expressions[0], 108)).toMatchObject({ "segmentIndex": 0 });
    expect(findChainAt(parsed.expressions[0], 103)).toMatchObject({ "segmentIndex": -1 });
  });
});
