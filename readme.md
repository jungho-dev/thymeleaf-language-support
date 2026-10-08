# Thymeleaf-Language-Support

Thymeleaf-Language-Support is a VS Code extension that adds Thymeleaf awareness to HTML templates without replacing
the built-in HTML language mode. It keeps HTML completion, formatting, and Emmet intact and layers Thymeleaf syntax
highlighting, an expression parser, Spring controller model validation, completion, hover, navigation, and fragment
tooling on top.

## Requirements

- VS Code `1.116.0` or later, or a VSCodium build on the same engine.
- No Java language server, JDK, or build tool is required. Java sources are indexed directly from the workspace.

## Installation

### From a VSIX file

1. Download `thymeleaf-language-support-<version>.vsix` from the repository root.
2. Install it with one of the following:
   - Extensions view, `...` menu, `Install from VSIX...`, then pick the file.
   - Command line:

     ```bash
     code --install-extension thymeleaf-language-support-1.1.1.vsix
     ```

     Use `codium` instead of `code` for VSCodium.
3. Reload the window when prompted.

### From source

Building needs [Bun](https://bun.sh) and Git.

```bash
git clone https://github.com/jungho-dev/thymeleaf-language-support.git
cd thymeleaf-language-support
bun install
bun run package
code --install-extension thymeleaf-language-support-1.1.1.vsix
```

`bun run package` type-checks, bundles `out/extension.js`, and writes the `.vsix` to the project root. The file name
follows the `version` field in `package.json`.

## Quick Start

1. Open the folder that contains your Spring project (the one with `src/main/java` and `src/main/resources`).
2. Open any template under `src/main/resources/templates/`. The extension activates on HTML and Java files.
3. Wait for the first index pass. Progress and counts appear in the `Thymeleaf-Language-Support` output channel
   (`Thymeleaf-Language-Support: Open Log Output`).

The defaults match the standard Spring Boot layout, including multi-module workspaces. For a different layout,
adjust `templateGlobs`, `javaGlobs`, `messageGlobs`, and `staticGlobs` in the settings below, then run
`Thymeleaf-Language-Support: Rebuild Template, Controller, and Message Index`.

To silence a rule without turning diagnostics off, add its code to `disabledDiagnosticCodes`:

```json
{
  "Thymeleaf-Language-Support.disabledDiagnosticCodes": ["thymeleaf-unknown-link"]
}
```

## Features

- Highlight `th:*`, `data-th-*`, `sec:*`, and `layout:*` attributes, and tokenize `${...}`, `*{...}`, `#{...}`,
  `@{...}`, `~{...}`, `|...|`, `__...__`, `[[...]]`, `[(...)]`, `/*[[...]]*/` in `th:inline="javascript"` blocks,
  parser-level comments `<!--/* */-->`, and prototype-only comments `<!--/*/ /*/-->` through an injection grammar.
- Parse every attribute value with a Thymeleaf standard expression and SpEL subset grammar and report positioned
  syntax errors: missing operators, unquoted text, dangling `.`, unmatched ternary, broken link parameters, and
  missing fragment selectors, on top of bracket, string, and literal-substitution structure checks.
- Index Spring controllers: `model.addAttribute`, `ModelAndView`, `@ModelAttribute` methods and parameters,
  handler command objects, `@ControllerAdvice`, `@SessionAttributes`, flash and request attributes, and the view
  names each handler returns. Infer the Java type of each attribute from literals, constructors, locals,
  parameters, fields, and service method return types.
- Index Java classes (fields, getters, Lombok `@Data`/`@Getter`/`@Value`, records, enums, inheritance) and
  validate `${user.nmae}` style property chains, `th:each` element types, status variables, `th:with` locals,
  `th:object` selections, and fragment parameters. Report model attributes that no mapped controller adds.
- Validate `#{...}` keys and argument counts against `messages*.properties`, `@{...}` paths against controller
  mappings and static resources, path variables against link parameters, and fragment names and arities against
  the referenced template.
- Complete attribute names, model attributes, Java properties and methods, utility objects, message keys,
  controller URLs, static resources, template names, and fragment names.
- Hover: attribute documentation, resolved Java type and declaring controller for model attributes, property
  declaration site, message values per locale, matching handler for a URL, and fragment signatures.
- Navigate: go to definition and find references for model attributes, Java properties, message keys, URLs,
  static resources, and fragments. Document links open templates and static files directly.
- Java side: CodeLens to open the returned template and to list template usages of each model attribute, a
  diagnostic for view names without a template, go to definition from a view name to the template, references
  from an attribute literal to its template usages, and view-name completion inside `return "..."`.
- Signature help for fragment arguments and message placeholders.
- Snippets (`th-html`, `th:text`, `th:each`, `th-each-block`, `th-switch`, `th:fragment`, `th:replace`, `th-form`,
  `th-block`, `th-inline-js`, `th-comment`, `layout:decorate`, `sec:authorize`, and more).

## Commands

| Command | Purpose |
| --- | --- |
| `Thymeleaf-Language-Support.validate` | Re-run diagnostics on the active HTML or Java document and report the count. |
| `Thymeleaf-Language-Support.gotoFragment` | Open the fragment template referenced at the cursor. |
| `Thymeleaf-Language-Support.rebuildIndex` | Rescan templates, Java sources, message bundles, and static resources. |
| `Thymeleaf-Language-Support.openLogOutput` | Open the Thymeleaf-Language-Support output channel. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `Thymeleaf-Language-Support.logLevel` | `info` | Controls extension logging: `off`, `debug`, `info`, `hint`, `warn`, `error`. |
| `Thymeleaf-Language-Support.diagnosticsEnabled` | `true` | Enables template diagnostics. |
| `Thymeleaf-Language-Support.disabledDiagnosticCodes` | `[]` | Diagnostic codes to suppress while diagnostics remain enabled. |
| `Thymeleaf-Language-Support.languageFeaturesEnabled` | `true` | Enables completion, hover, navigation, signature help, links, and symbols. |
| `Thymeleaf-Language-Support.javaEnabled` | `true` | Indexes Java sources for model validation and Java-side features. |
| `Thymeleaf-Language-Support.modelValidationEnabled` | `true` | Reports unknown model attributes and properties. |
| `Thymeleaf-Language-Support.linkValidationEnabled` | `true` | Reports `@{...}` paths without a mapping or static resource. |
| `Thymeleaf-Language-Support.messageValidationEnabled` | `true` | Reports unknown message keys and argument count mismatches. |
| `Thymeleaf-Language-Support.codeLensEnabled` | `true` | Shows CodeLens in Java controllers. |
| `Thymeleaf-Language-Support.additionalAttributes` | `[]` | Extra `th:*` names accepted without an unknown-attribute diagnostic. |
| `Thymeleaf-Language-Support.templateGlobs` | `["**/templates/**"]` | Roots under which template names are resolved. |
| `Thymeleaf-Language-Support.javaGlobs` | `["**/src/main/java/**/*.java"]` | Java sources to index. |
| `Thymeleaf-Language-Support.messageGlobs` | messages, i18n | Message bundles to index. |
| `Thymeleaf-Language-Support.staticGlobs` | Spring static roots | Static resource roots for `@{...}` validation. |
| `Thymeleaf-Language-Support.searchExclude` | build dirs | Glob patterns excluded from scanning. |
| `Thymeleaf-Language-Support.maxDocumentLength` | `300000` | Skips diagnostics above this document length. |

## Diagnostics

| Code | Severity | Meaning |
| --- | --- | --- |
| `thymeleaf-unclosed-expression` | error | `${`, `*{`, `#{`, `@{`, `~{`, `(`, or `[` is never closed. |
| `thymeleaf-unclosed-string` | error | A `'...'` literal is never closed. |
| `thymeleaf-unexpected-closing` | error | A closing bracket has no opener. |
| `thymeleaf-mismatched-bracket` | error | A closing bracket does not match the innermost opener. |
| `thymeleaf-empty-expression` | warning | `${}` or another empty expression. |
| `thymeleaf-nested-expression` | warning | `${}` nested inside `${}` or `*{}` outside preprocessing. |
| `thymeleaf-unclosed-literal-substitution` | error | `|...|` is never closed. |
| `thymeleaf-invalid-message-key` | warning | `#{...}` key is not a dotted identifier or expression. |
| `thymeleaf-expression-syntax` | error | The expression parser rejected the value (message names the token and position). |
| `thymeleaf-missing-value` | warning | A dialect attribute has no value. |
| `thymeleaf-empty-value` | warning | A dialect attribute value is blank. |
| `thymeleaf-unknown-attribute` | warning or information | Attribute name is not a known processor; warning when a close match exists. |
| `thymeleaf-deprecated-attribute` | warning | Attribute is deprecated or removed. |
| `thymeleaf-duplicate-attribute` | error | The same dialect attribute appears twice on one element. |
| `thymeleaf-invalid-each` | error | `th:each` is not `item : ${items}` or `item, stat : ${items}`. |
| `thymeleaf-invalid-inline` | error | `th:inline` is not `text`, `javascript`, `css`, or `none`. |
| `thymeleaf-invalid-fragment` | error | `th:fragment` is not `name` or `name(params)`. |
| `thymeleaf-invalid-remove` | error | `th:remove` is not a known removal mode. |
| `thymeleaf-invalid-assignation` | error | `th:with`, `th:attr`, `th:attrappend`, or `th:attrprepend` lacks `name=value`. |
| `thymeleaf-object-expression` | warning | `th:object` is not a `${...}` expression. |
| `thymeleaf-unescaped-text` | hint | `th:utext` renders unescaped HTML. |
| `thymeleaf-unclosed-inline` | error | `[[` or `[(` is never closed. |
| `thymeleaf-link-path-variable` | warning | `@{/x/{id}}` has no `id=` parameter. |
| `thymeleaf-unknown-template` | warning | Referenced template file was not found. |
| `thymeleaf-unknown-fragment` | warning | Referenced fragment name is not defined in the target template. |
| `thymeleaf-fragment-arity` | warning | Fragment argument count or names do not match the signature. |
| `thymeleaf-unknown-model-attribute` | warning | `${root}` is not added by any controller mapped to this template. |
| `thymeleaf-unknown-property` | warning | Property or method does not exist on the inferred Java type. |
| `thymeleaf-selection-without-object` | warning | `*{...}` used without an enclosing `th:object`. |
| `thymeleaf-unknown-message-key` | warning | `#{key}` is missing from the indexed bundles. |
| `thymeleaf-message-arity` | information | Fewer arguments than `{n}` placeholders. |
| `thymeleaf-unknown-link` | information | `@{/path}` matches neither a mapping nor a static resource. |
| `thymeleaf-missing-view` | warning | Java: returned view name has no template file. |

Model validation only runs for templates that at least one indexed controller returns (directly or through a
fragment include chain). Handlers that call `addAllAttributes`, `mergeAttributes`, or use non-literal attribute
names mark the template as dynamic and suppress unknown-attribute reports while property checks stay active.

## Development

| Step | Command |
| --- | --- |
| Install | `bun install` |
| Type check and bundle | `bun run compile` |
| Unit tests (parser, Java model, message model, semantic model, grammar tokenization) | `bun test` |
| Editor e2e tests (launches VSCodium or VS Code with an isolated profile) | `bun run test:e2e` |
| Package | `bun run package` |

The e2e runner picks the editor from `VSCODE_EXE`, then from a `codium`/`code` launcher on `PATH`, and otherwise
downloads a stable VS Code build through `@vscode/test-electron`.

## License

Apache-2.0. See [license.md](license.md).

The extension icon is the Thymeleaf logo from [thymeleaf.org](https://www.thymeleaf.org/). Thymeleaf is a project of
The Thymeleaf Team. This extension is an independent community project and is not affiliated with or endorsed by it.
