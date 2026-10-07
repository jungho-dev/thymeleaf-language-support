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
