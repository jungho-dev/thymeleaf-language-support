import { describe, expect, test } from "bun:test";
import { collectLocalTypes, inferExpressionType, parseJavaFile, resolveAttributeTypes } from "./JavaModel";

const CONTROLLER = `package com.example.web;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;

/** 사용자 화면 */
@Controller
@RequestMapping("/users")
@SessionAttributes({"filter"})
public class UserController {

  private final UserService userService;

  public UserController(UserService userService) {
    this.userService = userService;
  }

  @ModelAttribute("menu")
  public List<MenuItem> menu() {
    return List.of();
  }

  @GetMapping({"", "/list"})
  public String list(Model model, @RequestParam(required = false) String keyword, Pageable pageable) {
    List<User> users = userService.findAll(keyword); // "not a view"
    model.addAttribute("users", users);
    model.addAttribute("count", users.size());
    model.addAttribute("title", "User list");
    populateCommon(model);
    return "user/list";
  }

  @GetMapping("/{id}")
  public ModelAndView detail(@PathVariable Long id, HttpServletRequest request) {
    ModelAndView mav = new ModelAndView("user/detail", "user", userService.findOne(id));
    mav.addObject("address", userService.findOne(id).getAddress());
    request.setAttribute("now", LocalDateTime.now());
    return mav;
  }

  @PostMapping("/save")
  public String save(@Valid @ModelAttribute("form") UserForm form, BindingResult result, RedirectAttributes redirectAttributes) {
    if (result.hasErrors()) {
      return "user/form";
    }
    redirectAttributes.addFlashAttribute("saved", true);
    return "redirect:/users";
  }

  @GetMapping("/edit/{id}")
  public String edit(@PathVariable Long id, Model model, UserForm userForm) {
    String view = "user/form";
    model.addAllAttributes(Map.of());
    return view;
  }

  @GetMapping("/report")
  public void report(Model model) {
    model.addAttribute("rows", new ArrayList<ReportRow>());
  }

  private void populateCommon(Model model) {
    model.addAttribute("common", new CommonInfo());
  }
}
`;

const POJO = `package com.example.domain;

import lombok.Data;

@Data
public class User extends BaseEntity {
  private Long id;
  private String name;
  private boolean active;
  private Address address;
  private List<Role> roles;

  public String getDisplayName() {
    return name;
  }
}

record Address(String city, String street) {}

enum Role { ADMIN, USER; }

public class BaseEntity {
  private LocalDateTime createdAt;
  public LocalDateTime getCreatedAt() { return createdAt; }
}
`;

// 1. 컨트롤러 파싱 ---------------------------------------------------------------------------
describe(`parseJavaFile controller`, () => {
  const file = parseJavaFile(CONTROLLER, `C:/src/UserController.java`);
  const controller = file.types[0];

  test(`detects controller metadata`, () => {
    expect(file.packageName).toBe(`com.example.web`);
    expect(controller.name).toBe(`UserController`);
    expect(controller.isController).toBe(true);
    expect(controller.classPaths).toEqual([`/users`]);
    expect(controller.sessionAttributes).toEqual([`filter`]);
    expect(controller.fields.map((field) => [field.name, field.type])).toEqual([[`userService`, `UserService`]]);
    expect(controller.methods.map((method) => method.name)).toEqual([`menu`, `list`, `detail`, `save`, `edit`, `report`, `populateCommon`]);
  });

  test(`extracts handlers with combined paths, methods, and views`, () => {
    const names = controller.handlers.map((handler) => handler.methodName);
    expect(names).toEqual([`list`, `detail`, `save`, `edit`, `report`]);
    const list = controller.handlers[0];
    expect(list.paths).toEqual([`/users`, `/users/list`]);
    expect(list.httpMethods).toEqual([`GET`]);
    expect(list.viewNames.map((view) => view.name)).toEqual([`user/list`]);
    expect(CONTROLLER.slice(list.viewNames[0].offset, list.viewNames[0].offset + list.viewNames[0].length)).toBe(`user/list`);
    expect(list.viewNames[0].line).toBe(CONTROLLER.slice(0, list.viewNames[0].offset).split(`\n`).length - 1);
  });

  test(`extracts model attributes from calls, params, constructors, and request attributes`, () => {
    const list = controller.handlers[0];
    expect(list.attributes.map((attribute) => `${attribute.name}:${attribute.source}`)).toEqual([`users:addAttribute`, `count:addAttribute`, `title:addAttribute`]);
    const detail = controller.handlers[1];
    expect(detail.attributes.map((attribute) => `${attribute.name}:${attribute.source}`).sort()).toEqual([`address:addAttribute`, `now:request`, `user:view`]);
    const save = controller.handlers[2];
    expect(save.attributes.map((attribute) => `${attribute.name}:${attribute.source}:${attribute.typeName}`)).toEqual([`form:param:UserForm`]);
    expect(save.viewNames.map((view) => view.name)).toEqual([`user/form`]);
    expect(controller.flashAttributes.map((attribute) => attribute.name)).toEqual([`saved`]);
  });

  test(`handles returned variables, dynamic models, implicit views, and private helpers`, () => {
    const edit = controller.handlers[3];
    expect(edit.viewNames.map((view) => view.name)).toEqual([`user/form`]);
    expect(edit.dynamic).toBe(true);
    expect(edit.attributes.map((attribute) => attribute.name)).toEqual([`userForm`]);
    const report = controller.handlers[4];
    expect(report.viewNames.map((view) => [view.name, view.implicit])).toEqual([[`users/report`, true]]);
    expect(controller.classAttributes.map((attribute) => attribute.name)).toContain(`common`);
    expect(controller.modelAttributeMethods.map((attribute) => [attribute.name, attribute.typeName])).toEqual([[`menu`, `List<MenuItem>`]]);
    expect(controller.dynamicModel).toBe(true);
  });

  test(`infers attribute value types through locals, fields, and service methods`, () => {
    const service = parseJavaFile(`package com.example; public class UserService { public List<User> findAll(String k) { return null; } public User findOne(Long id) { return null; } }`, `C:/src/UserService.java`).types[0];
    const user = parseJavaFile(POJO, `C:/src/User.java`).types[0];
    const lookup = (name: string) => [controller, service, user].find((type) => type.name === name);
    resolveAttributeTypes(file, CONTROLLER, lookup);
    const byName = new Map(controller.classAttributes.map((attribute) => [attribute.name, attribute.typeName]));
    expect(byName.get(`users`)).toBe(`List<User>`);
    expect(byName.get(`title`)).toBe(`String`);
    expect(byName.get(`count`)).toBeUndefined();
    expect(byName.get(`address`)).toBe(`Address`);
    expect(byName.get(`rows`)).toBe(`ArrayList<ReportRow>`);
    expect(byName.get(`common`)).toBe(`CommonInfo`);
  });
});

// 2. POJO 파싱 ------------------------------------------------------------------------------
describe(`parseJavaFile pojo`, () => {
  const file = parseJavaFile(POJO, `C:/src/User.java`);

  test(`parses classes, records, enums, lombok, and inheritance`, () => {
    expect(file.types.map((type) => `${type.kind}:${type.name}`)).toEqual([`class:User`, `record:Address`, `enum:Role`, `class:BaseEntity`]);
    const user = file.types[0];
    expect(user.extendsName).toBe(`BaseEntity`);
    expect(user.lombokGetters).toBe(true);
    expect(user.fields.map((field) => `${field.name}:${field.type}`)).toEqual([`id:Long`, `name:String`, `active:boolean`, `address:Address`, `roles:List<Role>`]);
    expect(user.methods.map((method) => `${method.name}:${method.returnType}`)).toEqual([`getDisplayName:String`]);
    expect(file.types[1].recordComponents.map((component) => component.name)).toEqual([`city`, `street`]);
    expect(file.types[2].enumConstants).toEqual([`ADMIN`, `USER`]);
    expect(file.types[3].methods[0].name).toBe(`getCreatedAt`);
  });

  test(`ignores comments and strings that look like declarations`, () => {
    const tricky = parseJavaFile(`package a; /* class Fake { */ public class Real { String s = "class Nope {"; // class Nope2 {\n public String getS() { return s; } }`, `C:/a/Real.java`);
    expect(tricky.types.map((type) => type.name)).toEqual([`Real`]);
    expect(tricky.types[0].methods.map((method) => method.name)).toEqual([`getS`]);
  });
});

// 3. 타입 추론 ------------------------------------------------------------------------------
describe(`inferExpressionType`, () => {
  const lookup = () => undefined;
  const context = { "params": new Map([[`id`, `Long`]]), "locals": collectLocalTypes(`List<Item> items = new ArrayList<>(); var total = 3L; Map<String, Object> extra = new HashMap<>();`, []), "fields": new Map([[`repo`, `ItemRepository`]]), "lookupType": lookup };

  test(`infers literals, constructors, locals, params, and factories`, () => {
    expect(inferExpressionType(`"x"`, context)).toBe(`String`);
    expect(inferExpressionType(`12`, context)).toBe(`Integer`);
    expect(inferExpressionType(`1.5`, context)).toBe(`Double`);
    expect(inferExpressionType(`true`, context)).toBe(`Boolean`);
    expect(inferExpressionType(`new Order()`, context)).toBe(`Order`);
    expect(inferExpressionType(`new ArrayList<Order>()`, context)).toBe(`ArrayList<Order>`);
    expect(inferExpressionType(`items`, context)).toBe(`List<Item>`);
    expect(inferExpressionType(`total`, context)).toBe(`Long`);
    expect(inferExpressionType(`id`, context)).toBe(`Long`);
    expect(inferExpressionType(`List.of(1, 2)`, context)).toBe(`List`);
    expect(inferExpressionType(`(String) extra.get("k")`, context)).toBe(`String`);
    expect(inferExpressionType(`repo.findAll()`, context)).toBeUndefined();
  });
});
