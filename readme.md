# Thymeleaf-Language-Support

Thymeleaf-Language-Support is a VS Code extension that adds Thymeleaf awareness to HTML templates without replacing
the built-in HTML language mode. It keeps HTML completion, formatting, and Emmet intact and layers Thymeleaf syntax
highlighting, template diagnostics, completion, hover documentation, fragment symbols, and fragment navigation on top.

## Features

- Highlight `th:*`, `data-th-*`, `sec:*`, and `layout:*` attributes, and tokenize `${...}`, `*{...}`, `#{...}`,
  `@{...}`, `~{...}`, `|...|`, `__...__`, `[[...]]`, `[(...)]`, `/*[[...]]*/` in `th:inline="javascript"` blocks,
  parser-level comments `<!--/* */-->`, and prototype-only comments `<!--/*/ /*/-->` through an injection grammar.
- Diagnose expression syntax: unclosed `${`, unclosed string literals, mismatched or unexpected brackets, empty
  expressions, nested `${}` inside `${}`, unclosed `|...|`, and invalid message keys.
- Diagnose attribute usage: unknown `th:*` names with a spelling suggestion, deprecated `th:include`,
  `th:substituteby`, `layout:decorator`, duplicate attributes, missing or empty values, invalid `th:each`,
  `th:inline`, `th:remove`, `th:fragment`, `th:with`, `th:attr`, and `th:object` forms, and unescaped `th:utext`.
- Diagnose fragment references whose template file does not exist under the configured template roots.
- Complete `th:`, `sec:`, `layout:`, and `data-th-` attribute names with documentation, and `#` utility objects
  inside expressions.
- Show hover documentation for dialect attributes and utility objects.
- List `th:fragment` and `layout:fragment` definitions in the outline and symbol picker.
- Jump from `th:insert`, `th:replace`, `th:include`, and `layout:decorate` references to the fragment template and
  element through Go to Definition or the context menu command.
- Insert Thymeleaf snippets (`th-html`, `th:text`, `th:each`, `th-each-block`, `th-switch`, `th:fragment`,
  `th:replace`, `th-form`, `th-block`, `th-inline-js`, `th-comment`, `layout:decorate`, `sec:authorize`, and more).

## Commands

| Command | Purpose |
| --- | --- |
| `Thymeleaf-Language-Support.validate` | Re-run diagnostics on the active HTML template and report the count. |
| `Thymeleaf-Language-Support.gotoFragment` | Open the fragment template referenced at the cursor. |
| `Thymeleaf-Language-Support.openLogOutput` | Open the Thymeleaf-Language-Support output channel. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `Thymeleaf-Language-Support.logLevel` | `info` | Controls extension logging: `off`, `debug`, `info`, `hint`, `warn`, `error`. |
| `Thymeleaf-Language-Support.diagnosticsEnabled` | `true` | Enables template diagnostics. |
| `Thymeleaf-Language-Support.disabledDiagnosticCodes` | `[]` | Diagnostic codes to suppress while diagnostics remain enabled. |
| `Thymeleaf-Language-Support.languageFeaturesEnabled` | `true` | Enables completion, hover, symbols, and go-to-definition. |
| `Thymeleaf-Language-Support.additionalAttributes` | `[]` | Extra `th:*` names accepted without an unknown-attribute diagnostic. |
| `Thymeleaf-Language-Support.templateGlobs` | `["**/templates/**"]` | Roots under which fragment template names are resolved. |
| `Thymeleaf-Language-Support.searchExclude` | build dirs | Glob patterns excluded from template resolution. |
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
| `thymeleaf-unknown-template` | warning | Referenced template file was not found. |

## Development

| Step | Command |
| --- | --- |
| Install | `bun install` |
| Type check and bundle | `bun run compile` |
| Unit tests (model + grammar tokenization against the VS Code HTML grammar) | `bun test` |
| Editor e2e tests (launches VSCodium or VS Code with an isolated profile) | `bun run test:e2e` |
| Package | `bun run package` |

The e2e runner picks the editor from `VSCODE_EXE`, then from a `codium`/`code` launcher on `PATH`, and otherwise
downloads a stable VS Code build through `@vscode/test-electron`.
