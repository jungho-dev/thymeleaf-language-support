# Thymeleaf-Language-Support Architecture

## Runtime Surface

```text
package.json activationEvents (onLanguage:html)
  -> src/extension.ts activate(context)
  -> TemplateIndexService()
  -> ThymeleafDiagnosticProvider + ThymeleafLanguageProvider (each over indexService)
  -> ThymeleafCommand(indexService, diagnosticProvider, languageProvider)
package.json contributes.grammars (thymeleaf.injection -> text.html.basic, text.html.derivative)
package.json contributes.snippets (html)
```

`src/extension.ts` owns activation, output logging setup, provider registration for the `html` language, the
template file watcher, debounced document listeners, configuration refresh, and disposable cleanup. Syntax
highlighting needs no runtime code; it is a TextMate injection grammar loaded by VS Code itself.

## Source Map

```text
src/
|-- commands/
|   `-- ThymeleafCommand.ts            validate, gotoFragment, openLogOutput
|-- providers/
|   |-- ThymeleafDiagnosticProvider.ts model diagnostics -> VS Code diagnostics, template existence check
|   `-- ThymeleafLanguageProvider.ts   attribute/utility completion, hover, fragment symbols, definition
|-- services/
|   `-- TemplateIndexService.ts        template name -> file resolution, fragment position lookup, cache
|-- models/
|   `-- ThymeleafModel.ts              pure parser: elements, dialect attributes, inlines, fragments,
|                                      expression bracket checker, attribute rules, fragment reference parser
|-- assets/
|   |-- data/dialect.ts                standard, Spring Security, Layout dialect catalog and utility objects
|   |-- scripts/                       logger, notify
|   |-- fixtures/                      VS Code HTML grammars used by the grammar tokenization tests
|   `-- types/                         ambient path aliases
|-- grammar/Grammar.spec.ts            vscode-textmate tokenization tests for the injection grammar
|-- test/                              @vscode/test-electron runner, mocha e2e suite, fixture workspace
`-- exports/                           barrel exports for local aliases
syntaxes/thymeleaf.injection.tmLanguage.json   injection grammar
snippets/thymeleaf.json                        html snippets
```

Generated files live in `out/` (extension bundle) and `out-test/` (compiled e2e tests). They are not source of
truth.

## Highlighting

```text
injectionSelector:
  L:text.html -comment -string -source -meta.embedded   attributes, [[...]], [(...)], thymeleaf comments
  L:text.html source.js comment.block                   /*[[...]]*/ in script blocks
  L:text.html source.css comment.block                  /*[[...]]*/ in style blocks
```

A dialect attribute rule begins at `th:name=` (or `data-th-name=`, `sec:`, `layout:`) and takes priority over the
HTML grammar's own attribute rule. Expression rules are named `meta.template.expression.*.thymeleaf` so that
string-scoped injections from themes (for example bracket coloring inside strings) do not capture the closing `}`.
Attribute names keep `entity.other.attribute-name.html` so existing themes color them unchanged.

## Diagnostics

```text
analyzeTemplate(text)
  -> parseTemplate: scanner over tags, attributes, text inlines, script/style bodies, comments
  -> per element: duplicate dialect attributes
  -> per attribute: missing/empty value, catalog lookup (unknown/deprecated), checkExpression, kind rules
  -> per inline: unclosed [[ / [( and checkExpression
ThymeleafDiagnosticProvider.apply
  -> analyzeTemplate + async template existence check for th:insert/replace/include and layout:decorate
  -> drops results when the document version changed during the async step
```

Diagnostics are produced only for documents that declare `xmlns:th` or contain at least one dialect attribute, so
plain HTML files stay silent. Unknown `th:*` names are information-level because Thymeleaf renders them as plain
attributes; they become warnings only when a standard name is within two edits.

## Fragment Resolution

```text
th:replace="~{fragments/footer :: copy}"
  -> parseFragmentReference: template=fragments/footer, selector=copy
  -> TemplateIndexService.resolveTemplate: findFiles("<templateGlob>/fragments/footer.html"),
     fallback "**/fragments/footer.html", nearest path to the current document wins
  -> findFragmentPosition: th:fragment name match, then id="..." for #selectors, else line 0
```

The cache is cleared when any `.html` file is created or deleted and when the validate command runs.
