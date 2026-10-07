// assets/data/dialect.ts

import type { DialectAttributeType, DialectPrefixType, UtilityObjectType } from "@exportTypes";

// 1. 표준 다이얼렉트 속성 -------------------------------------------------------------
const STANDARD_ATTRIBUTES: DialectAttributeType[] = [
  { "name": `text`, "kind": `text`, "doc": `Sets the element body to the escaped result of the expression.` },
  { "name": `utext`, "kind": `utext`, "doc": `Sets the element body to the unescaped result of the expression. Never use with untrusted data.` },
  { "name": `if`, "kind": `expression`, "doc": `Renders the element only when the expression evaluates to true.` },
  { "name": `unless`, "kind": `expression`, "doc": `Renders the element only when the expression evaluates to false.` },
  { "name": `switch`, "kind": `expression`, "doc": `Evaluates an expression for child th:case elements.` },
  { "name": `case`, "kind": `case`, "doc": `Renders the element when its value equals the enclosing th:switch result. Use * for the default case.` },
  { "name": `each`, "kind": `each`, "doc": `Iterates over an iterable: th:each="item, stat : \${items}".` },
  { "name": `with`, "kind": `assignation`, "doc": `Declares local variables: th:with="name=\${value}, other=\${x}".` },
  { "name": `object`, "kind": `object`, "doc": `Selects the object used by *{...} selection expressions in the element body.` },
  { "name": `attr`, "kind": `assignation`, "doc": `Sets any attributes: th:attr="src=@{/img.png}, title=#{logo}".` },
  { "name": `attrappend`, "kind": `assignation`, "doc": `Appends to existing attribute values: th:attrappend="class=\${' ' + cssStyle}".` },
  { "name": `attrprepend`, "kind": `assignation`, "doc": `Prepends to existing attribute values.` },
  { "name": `classappend`, "kind": `expression`, "doc": `Appends the expression result to the class attribute.` },
  { "name": `styleappend`, "kind": `expression`, "doc": `Appends the expression result to the style attribute.` },
  { "name": `insert`, "kind": `fragment-ref`, "doc": `Inserts the fragment as the body of the host element: th:insert="~{template :: fragment}".` },
  { "name": `replace`, "kind": `fragment-ref`, "doc": `Replaces the host element with the fragment: th:replace="~{template :: fragment}".` },
  { "name": `include`, "kind": `fragment-ref`, "doc": `Inserts the fragment content without its container tag.`, "deprecated": `Deprecated since Thymeleaf 3.0 and removed in 3.1. Use th:insert or th:replace.` },
  { "name": `substituteby`, "kind": `fragment-ref`, "doc": `Legacy alias of th:replace.`, "deprecated": `Removed in Thymeleaf 3.0. Use th:replace.` },
  { "name": `fragment`, "kind": `fragment-def`, "doc": `Declares a reusable fragment: th:fragment="name(param1, param2)".` },
  { "name": `remove`, "kind": `remove`, "doc": `Removes markup at render time: all, body, tag, all-but-first, or none.` },
  { "name": `inline`, "kind": `inline`, "doc": `Enables inlining mode for the element body: text, javascript, css, or none.` },
  { "name": `assert`, "kind": `assert`, "doc": `Throws an exception unless every comma-separated expression evaluates to true.` },
  { "name": `ref`, "kind": `plain`, "doc": `Declares a reference name usable in fragment selectors (ref=name).` },
  { "name": `block`, "kind": `fixed`, "doc": `Synthetic container element: <th:block th:each=...>. Removed from the output.` },
  { "name": `alt-title`, "kind": `expression`, "doc": `Sets alt and title to the same value.` },
  { "name": `lang-xmllang`, "kind": `expression`, "doc": `Sets lang and xml:lang to the same value.` },
  { "name": `field`, "kind": `expression`, "doc": `Spring: binds a form input to a command object property: th:field="*{name}".` },
  { "name": `errors`, "kind": `expression`, "doc": `Spring: renders the validation errors of a field: th:errors="*{name}".` },
  { "name": `errorclass`, "kind": `expression`, "doc": `Spring: appends the given CSS class when the bound field has errors.` },
  { "name": `method`, "kind": `expression`, "doc": `Spring: sets the form method and adds a hidden _method field for PUT/DELETE/PATCH.` },
  { "name": `action`, "kind": `expression`, "doc": `Spring: sets the form action and injects CSRF/request data values.` },
];

// 2. HTML 속성 값 설정자 (th:xxx 로 값 지정 가능한 표준 HTML 속성) -------------------------
const HTML_ATTRIBUTE_NAMES = [
  `abbr`, `accept`, `accept-charset`, `accesskey`, `align`, `alt`, `archive`, `audio`, `autocomplete`, `axis`, `background`, `bgcolor`,
  `border`, `cellpadding`, `cellspacing`, `challenge`, `charset`, `cite`, `class`, `classid`, `codebase`, `codetype`, `cols`, `colspan`,
  `compact`, `content`, `contenteditable`, `contextmenu`, `data`, `datetime`, `dir`, `draggable`, `dropzone`, `enctype`, `for`, `form`,
  `formaction`, `formenctype`, `formmethod`, `formtarget`, `frame`, `frameborder`, `headers`, `height`, `high`, `href`, `hreflang`, `hspace`,
  `http-equiv`, `icon`, `id`, `inputmode`, `keytype`, `kind`, `label`, `lang`, `list`, `longdesc`, `low`, `manifest`, `marginheight`,
  `marginwidth`, `max`, `maxlength`, `media`, `min`, `minlength`, `name`, `optimum`, `pattern`, `placeholder`, `poster`, `preload`,
  `radiogroup`, `rel`, `rev`, `role`, `rows`, `rowspan`, `rules`, `sandbox`, `scheme`, `scope`, `scrolling`, `size`, `sizes`, `span`,
  `spellcheck`, `src`, `srcset`, `srclang`, `standby`, `start`, `step`, `style`, `summary`, `tabindex`, `target`, `title`, `type`, `usemap`,
  `value`, `valuetype`, `width`, `wrap`, `xmlbase`, `xmllang`, `xmlspace`,
  `async`, `autofocus`, `autoplay`, `checked`, `controls`, `declare`, `default`, `defer`, `disabled`, `formnovalidate`, `hidden`, `ismap`,
  `loop`, `multiple`, `novalidate`, `nowrap`, `open`, `pubdate`, `readonly`, `required`, `reversed`, `scoped`, `seamless`, `selected`,
];

// 3. Spring Security 다이얼렉트 --------------------------------------------------------
const SECURITY_ATTRIBUTES: DialectAttributeType[] = [
  { "name": `authorize`, "kind": `spel`, "doc": `Renders the element when the Spring Security expression allows it: sec:authorize="hasRole('ADMIN')".` },
  { "name": `authorize-url`, "kind": `plain`, "doc": `Renders the element when the current user may access the given URL.` },
  { "name": `authorize-acl`, "kind": `plain`, "doc": `Renders the element when the ACL expression grants access: sec:authorize-acl="\${obj} :: 'read'".` },
  { "name": `authorize-expr`, "kind": `spel`, "doc": `Alias of sec:authorize.` },
  { "name": `authentication`, "kind": `spel`, "doc": `Sets the element text to an Authentication property: sec:authentication="name".` },
];

// 4. Layout 다이얼렉트 ------------------------------------------------------------------
const LAYOUT_ATTRIBUTES: DialectAttributeType[] = [
  { "name": `decorate`, "kind": `fragment-ref`, "doc": `Decorates this template with the given layout: layout:decorate="~{layouts/default}".` },
  { "name": `decorator`, "kind": `fragment-ref`, "doc": `Legacy decoration attribute.`, "deprecated": `Deprecated in Layout Dialect 2.0. Use layout:decorate with a fragment expression.` },
  { "name": `fragment`, "kind": `fragment-def`, "doc": `Declares a layout fragment that content templates can override.` },
  { "name": `insert`, "kind": `fragment-ref`, "doc": `Inserts a fragment and allows child content to be passed in.` },
  { "name": `replace`, "kind": `fragment-ref`, "doc": `Replaces the element with a fragment and allows child content to be passed in.` },
  { "name": `include`, "kind": `fragment-ref`, "doc": `Legacy inclusion attribute.`, "deprecated": `Deprecated in Layout Dialect 2.0. Use layout:insert.` },
  { "name": `title-pattern`, "kind": `plain`, "doc": `Combines layout and content titles: layout:title-pattern="$LAYOUT_TITLE - $CONTENT_TITLE".` },
  { "name": `append`, "kind": `fixed`, "doc": `Appends the content element to the decorated element instead of replacing it.` },
  { "name": `prepend`, "kind": `fixed`, "doc": `Prepends the content element to the decorated element instead of replacing it.` },
];

// 5. 유틸리티 객체 --------------------------------------------------------------------
const UTILITY_OBJECTS: UtilityObjectType[] = [
  { "name": `ctx`, "doc": `The context object (IContext / IWebContext).` },
  { "name": `vars`, "doc": `The context variables map.` },
  { "name": `locale`, "doc": `The context locale.` },
  { "name": `request`, "doc": `The HttpServletRequest (web contexts).` },
  { "name": `response`, "doc": `The HttpServletResponse (web contexts).` },
  { "name": `session`, "doc": `The HttpSession (web contexts).` },
  { "name": `servletContext`, "doc": `The ServletContext (web contexts).` },
  { "name": `execInfo`, "doc": `Information about the template being processed: templateName, now, processedTemplateName.` },
  { "name": `messages`, "doc": `Externalized messages: #messages.msg('key'), #messages.msgOrNull(...).` },
  { "name": `uris`, "doc": `URI/URL escaping: #uris.escapePath(...), #uris.escapeQueryParam(...).` },
  { "name": `conversions`, "doc": `Conversion service access: #conversions.convert(object, 'java.lang.String').` },
  { "name": `dates`, "doc": `java.util.Date utilities: #dates.format(date, 'yyyy-MM-dd'), #dates.createNow().` },
  { "name": `calendars`, "doc": `java.util.Calendar utilities, analogous to #dates.` },
  { "name": `temporals`, "doc": `java.time utilities: #temporals.format(localDate, 'yyyy-MM-dd').` },
  { "name": `numbers`, "doc": `Number formatting: #numbers.formatDecimal(num, 1, 2), #numbers.formatInteger(num, 3, 'COMMA').` },
  { "name": `strings`, "doc": `String utilities: #strings.isEmpty, #strings.contains, #strings.toUpperCase, #strings.abbreviate.` },
  { "name": `objects`, "doc": `Object utilities: #objects.nullSafe(obj, default).` },
  { "name": `bools`, "doc": `Boolean evaluation: #bools.isTrue(obj), #bools.isFalse(obj).` },
  { "name": `arrays`, "doc": `Array utilities: #arrays.length, #arrays.contains, #arrays.isEmpty.` },
  { "name": `lists`, "doc": `List utilities: #lists.size, #lists.contains, #lists.sort.` },
  { "name": `sets`, "doc": `Set utilities: #sets.size, #sets.contains.` },
  { "name": `maps`, "doc": `Map utilities: #maps.size, #maps.containsKey.` },
  { "name": `aggregates`, "doc": `Aggregates over arrays or collections: #aggregates.sum, #aggregates.avg.` },
  { "name": `ids`, "doc": `Id attributes that may repeat: #ids.seq('x'), #ids.next('x'), #ids.prev('x').` },
  { "name": `fields`, "doc": `Spring: form field errors: #fields.hasErrors('name'), #fields.errors('name').` },
  { "name": `themes`, "doc": `Spring: theme message lookup: #themes.code('key').` },
  { "name": `mvc`, "doc": `Spring: MVC URI building: #mvc.url('HC#home').build().` },
  { "name": `requestdatavalues`, "doc": `Spring: request data value processing helpers.` },
  { "name": `httpServletRequest`, "doc": `Spring: the current HttpServletRequest (legacy alias of #request).` },
  { "name": `httpSession`, "doc": `Spring: the current HttpSession (legacy alias of #session).` },
  { "name": `authentication`, "doc": `Spring Security: the current Authentication object.` },
  { "name": `authorization`, "doc": `Spring Security: authorization checks: #authorization.expression('hasRole(''ADMIN'')').` },
];

const STANDARD_MAP: ReadonlyMap<string, DialectAttributeType> = new Map(STANDARD_ATTRIBUTES.map((entry) => [entry.name, entry]));
const SECURITY_MAP: ReadonlyMap<string, DialectAttributeType> = new Map(SECURITY_ATTRIBUTES.map((entry) => [entry.name, entry]));
const LAYOUT_MAP: ReadonlyMap<string, DialectAttributeType> = new Map(LAYOUT_ATTRIBUTES.map((entry) => [entry.name, entry]));
const HTML_ATTRIBUTE_SET: ReadonlySet<string> = new Set(HTML_ATTRIBUTE_NAMES);
const UTILITY_MAP: ReadonlyMap<string, UtilityObjectType> = new Map(UTILITY_OBJECTS.map((entry) => [entry.name, entry]));
const PASSTHROUGH_PATTERN = /^(?:data-|aria-|on[a-z]+$)/;

// 6. 조회 함수 -----------------------------------------------------------------------
export const findDialectAttribute = (prefix: DialectPrefixType, name: string): DialectAttributeType | undefined => {
  if (prefix === `sec`) {
    return SECURITY_MAP.get(name);
  }
  if (prefix === `layout`) {
    return LAYOUT_MAP.get(name);
  }
  const standard = STANDARD_MAP.get(name);
  if (standard) {
    return standard;
  }
  if (HTML_ATTRIBUTE_SET.has(name)) {
    return { "name": name, "kind": `expression`, "doc": `Sets the HTML attribute "${name}" to the expression result.` };
  }
  return undefined;
};
export const isPassthroughAttribute = (name: string): boolean => PASSTHROUGH_PATTERN.test(name);
export const listDialectAttributes = (prefix: DialectPrefixType): DialectAttributeType[] => {
  if (prefix === `sec`) {
    return SECURITY_ATTRIBUTES;
  }
  if (prefix === `layout`) {
    return LAYOUT_ATTRIBUTES;
  }
  const setters = HTML_ATTRIBUTE_NAMES.filter((name) => !STANDARD_MAP.has(name)).map((name): DialectAttributeType => ({ "name": name, "kind": `expression`, "doc": `Sets the HTML attribute "${name}" to the expression result.` }));
  return [...STANDARD_ATTRIBUTES, ...setters];
};
export const listStandardAttributeNames = (): string[] => [...STANDARD_MAP.keys()];
export const findUtilityObject = (name: string): UtilityObjectType | undefined => UTILITY_MAP.get(name);
export const listUtilityObjects = (): UtilityObjectType[] => UTILITY_OBJECTS;
