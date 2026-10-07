# Thymeleaf-Language-Support Architecture

## Runtime Surface

```text
package.json activationEvents (onLanguage:html, onLanguage:java)
  -> src/extension.ts activate(context)
  -> TemplateIndexService() + JavaIndexService() + MessageIndexService()
  -> SemanticIndexService(javaIndex, messageIndex, templateIndex)   pure adapter used by the models
  -> ThymeleafDiagnosticProvider + ThymeleafLanguageProvider (html)
  -> JavaViewProvider (java)
  -> ThymeleafCommand({ indexes, providers })
package.json contributes.grammars (thymeleaf.injection -> text.html.basic, text.html.derivative)
package.json contributes.snippets (html)
```

`src/extension.ts` owns activation, output logging, provider registration for `html` and `java`, the three file
watchers, debounced document listeners, index-update refresh, the status bar item, configuration rescans, and
disposable cleanup. Syntax highlighting needs no runtime code; it is a TextMate injection grammar loaded by VS Code.

## Source Map

```text
src/
|-- commands/
|   `-- ThymeleafCommand.ts            validate, gotoFragment, rebuildIndex, openTemplate, showAttributeUsages
|-- providers/
|   |-- ThymeleafDiagnosticProvider.ts analyzeTemplate + analyzeSemantics -> VS Code diagnostics
|   |-- ThymeleafLanguageProvider.ts   completion, hover, definition, references, signature help, links, symbols
|   `-- JavaViewProvider.ts            Java CodeLens, missing-view diagnostics, definition, references, completion
|-- services/
|   |-- TemplateIndexService.ts        template catalog, includer graph, static resources, attribute usages
|   |-- JavaIndexService.ts            Java file parse cache, type index, view index, url index, model contexts
|   |-- MessageIndexService.ts         properties bundles keyed by message key
|   `-- SemanticIndexService.ts        SemanticIndexType adapter (merges includer model contexts)
|-- models/                            pure, vscode-free, unit tested with bun
|   |-- ExpressionParser.ts            standard expression + SpEL subset recursive descent parser -> AST
|   |-- ThymeleafModel.ts              template scanner (element tree, attributes, inlines, fragments), scopes,
|   |                                  structural checks, syntax diagnostics
|   |-- JavaModel.ts                   Java source scanner (types, members, controllers, handlers, attributes),
|   |                                  expression type inference
|   |-- MessageModel.ts                .properties parser
|   `-- SemanticModel.ts               type resolution over chains, model/property/message/link/fragment checks
|-- assets/
|   |-- data/dialect.ts                standard, Spring Security, Layout dialect catalog and utility objects
|   |-- scripts/                       logger, notify
|   |-- fixtures/                      VS Code HTML grammars used by the grammar tokenization tests
|   `-- types/                         ambient path aliases
|-- grammar/Grammar.spec.ts            vscode-textmate tokenization tests for the injection grammar
|-- test/                              @vscode/test-electron runner, mocha e2e suite, fixture Spring workspace
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
HTML grammar's own attribute rule. Quotes carry `string.quoted.*.html` so themes color them like other attribute
quotes. Expression rules are named `meta.template.expression.*.thymeleaf` so string-scoped theme injections do not
capture the closing `}`. Root identifiers are `variable.other.readwrite.thymeleaf`, properties are
`variable.other.property.thymeleaf`, and plain tokens such as `col-md-6` are one `string.unquoted.token.thymeleaf`.

## Parsing Pipeline

```text
parseTemplate(text)
  -> element tree (open stack, void tags, closing tags), dialect attributes, [[ ]] inlines, fragments
  -> parseAttributeValue(value, kind, valueOffset) per attribute   (ExpressionParser)
     kinds: expression | each | assignation | fragment-def | fragment-ref | case | assert | spel | plain | ...
     output: syntax errors, expression nodes (${} *{} #{} @{} ~{}), chains (root + segments), link path and
             variables, message key, fragment template/selector, arguments, each vars, assignments
buildScopes(template)
  -> per element: inherited locals (th:each item/stat, th:with names, fragment params), th:object, insideFragment
analyzeTemplate(text)
  -> duplicate attributes, missing/empty values, catalog checks, checkExpression structure, parser errors,
     link path variables, kind-specific rules, inline checks
analyzeSemantics(template, scopes, index, options)
  -> resolveChain per chain: local | model | context | utility | object | unknown
     local types: th:each element type of the iterable, IterationStatus, th:with expression type
     model types: ModelAttributeType.typeName -> TypeRef -> workspace class (closed) or open
     segments: property (field/getter/Lombok/record, inherited), call (method), index (element/value type)
  -> diagnostics: unknown model attribute, unknown property, selection without object, message key/arity,
     link existence, fragment existence/arity
```

## Java Indexing

```text
JavaIndexService.scan()
  -> findFiles(javaGlobs) -> parseJavaFile(text) per file (comments masked, strings kept for literals)
  -> types: name, kind, annotations, extends, fields, methods, record components, enum constants, Lombok flag
  -> controllers: handlers (paths, http methods, view names from return/ModelAndView/setViewName/implicit),
     model attributes (addAttribute/addObject/put/setAttribute/addFlashAttribute, params, @ModelAttribute methods),
     dynamic flag (addAllAttributes, mergeAttributes, non-literal names)
  -> resolveAttributeTypes(file, text, lookupType) after the full scan (service return types need other files)
  -> derived: typeIndex (simple name), viewIndex (template name -> handlers), urlIndex (path pattern -> handler)
modelContextFor(templateName)
  -> handlers returning the template + class-wide attributes + @ControllerAdvice + session + flash
  -> SemanticIndexService merges the contexts of templates that include this one (depth 3)
```

The watcher re-parses changed Java files with a debounce and fires `onDidUpdate`, which refreshes diagnostics of
open documents and Java CodeLens.

## Fragment Resolution

```text
th:replace="~{fragments/footer :: copy(${year})}"
  -> expression node: template=fragments/footer, selector=copy, args=[${year}]
  -> TemplateIndexService.templateUri / resolveTemplate (indexed catalog first, findFiles fallback)
  -> fragmentCatalog(template): fragments with params, element tag names, ids
  -> findFragmentPosition: th:fragment name, then id="..." selector, then tag name, else line 0
```
