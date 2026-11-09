# Changelog

## \[ 1.0.0 \]

- 2026-10-07
- Initial release: Thymeleaf injection grammar for HTML, expression and attribute diagnostics, fragment template
  existence check, attribute and utility-object completion, hover documentation, fragment symbols, fragment
  go-to-definition, and HTML snippets.

## \[ 1.1.0 \]

- 2026-10-07
- Expression parser: Thymeleaf standard expression and SpEL subset grammar with positioned syntax errors
  (missing operators, unquoted text, dangling member access, unmatched ternary, link and fragment forms).
- Spring integration: controller, @ModelAttribute, handler-parameter, @ControllerAdvice, flash and session attribute
  indexing with value type inference; DTO field, getter, Lombok, and record property indexing; unknown model
  attribute and unknown property diagnostics with th:each, th:with, status variable, th:object, and fragment
  parameter scoping.
- Navigation: go to definition and references for model attributes, Java properties, message keys, controller URLs,
  static resources, and fragments; Java-side CodeLens, diagnostics, definition, references, and view-name completion.
- Parameters: fragment signature arity and name checks, link path variable checks, message placeholder arity,
  signature help for fragment and message arguments, document links for templates and static resources.
- Completion: model attributes, Java properties and methods, message keys, controller URLs, static resources,
  template names, and fragment names.
- Highlighting: attribute quotes keep the string scope, root identifiers use `variable.other.readwrite`,
  hyphenated tokens are no longer split by numeric highlighting.

## \[ Unreleased \]

- Icon: replaced the generated leaf with the official Thymeleaf logo; README gains requirements, installation, and
  quick start sections.
- Fragments: `th:ref` markers resolve as fragment selectors (`~{:: name}`) in diagnostics, completion, and
  navigation; named arguments to a fragment without a signature are accepted as fragment-local variables.
- Fragment arity: follows Thymeleaf `processParameters`; named arguments beside a signature
  (`popup(ref1=..., popupId='x')`) are accepted as fragment-local variables instead of reported as unknown
  parameters, and missing signature parameters, duplicate names, mixed named and positional arguments, and a
  parameterized fragment selected without arguments are reported.
- False positives: `~{}` empty fragments, HTML-entity operators (`&lt;`, `&gt;`, `&amp;&amp;`), SpEL unary
  signs and hex literals, record accessor calls (`guide.sections()`), members of types with an external superclass
  or a duplicated simple name, named arguments that call sites pass into a `th:fragment`, Spring request contexts, framework paths
  (`/login`, `/logout`, `/error`, `/webjars/**`), and modern HTML attributes (`th:nonce`, `th:integrity`) are no
  longer reported.
- Java model: a handler that passes the model to another object or returns `new ModelAndView(view, map)` is
  dynamic on its own (the class stays checked); `static final String` constants name attributes; servlet filters
  (`OncePerRequestFilter`, `GenericFilterBean`, `HttpFilter`, or `Filter` imported from `javax`/`jakarta.servlet`)
  are global request-attribute sources;
  `return "main.html"` maps to the `main` template; interfaces keep every super-interface.
- Model validation: roots on the left of an elvis `?:` or followed by `?.` no longer report an unknown model
  attribute.
- Java: `@RestController` and `@ResponseBody` handlers index their URL paths without view names; array mapping
  values whose strings contain braces (`value={"/page/{group}"}`) parse correctly; only literal or
  conditional-literal returns count as view names.
- Indexing: watchers honor `searchExclude` and the configured globs, and build-output template copies
  (`bin/`, `build/`) never replace a `src/` template entry; template and message scans read files in parallel.
- Performance: template parsing is linear in document size (inline `[[...]]` lookups no longer rescan to the end of
  the document per tag); diagnostics and language features share one versioned parse per open document; model
  contexts and type properties are cached per index revision; Java watcher batches rebuild derived indexes once.
- Memory: the template index keeps fragment catalogs and root identifier usages instead of full expression trees;
  references and Java CodeLens use precomputed positions instead of opening every usage file; closed documents are
  evicted from the parse cache; Java and message indexing is skipped until the workspace has a Thymeleaf template.
- Fixes: nested `th:object="*{...}"` no longer overflows the stack; `*{...}` without an object reports once per
  expression; `th:with` values can reference earlier assignments and `th:each` variables on the same element;
  rescans swap in a complete index instead of exposing a half-built one; static `.html` resources update the static
  index; Java missing-view diagnostics are suppressed in workspaces without templates and cleared when disabled.

## \[ 1.1.1 \]

- 2026-10-08T09:02:05.051Z

## \[ 1.1.2 \]

- 2026-11-02T06:13:38.576Z

## \[ 1.1.3 \]

- 2026-11-09T07:51:14.618Z
