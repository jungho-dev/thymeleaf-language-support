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
- Model validation: roots on the left of an elvis `?:` or followed by `?.` no longer report an unknown model
  attribute.
- Java: `@RestController` and `@ResponseBody` handlers index their URL paths without view names; array mapping
  values whose strings contain braces (`value={"/page/{group}"}`) parse correctly; only literal or
  conditional-literal returns count as view names.
- Indexing: watchers honor `searchExclude` and the configured globs, and build-output template copies
  (`bin/`, `build/`) never replace a `src/` template entry; template and message scans read files in parallel.

## \[ 1.1.1 \]

- 2026-10-08T09:02:05.051Z
