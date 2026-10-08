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

// 4. 인터셉터 모델 속성 -------------------------------------------------------
describe(`parseJavaFile interceptor`, () => {
  const INTERCEPTOR = `package com.example.handler;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.ModelAndView;

@Component
public class LayoutHandler implements HandlerInterceptor {
  private static final String CHECKED_AT = "checkedAt";

  @Override
  public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
    HttpSession session = request.getSession(false);
    session.setAttribute(CHECKED_AT, System.currentTimeMillis());
    return true;
  }

  @Override
  public void postHandle(HttpServletRequest request, HttpServletResponse response, Object handler, ModelAndView modelAndView) {
    LoginUser loginUser = findLoginUser(request);
    modelAndView.addObject("loginUser", loginUser);
    modelAndView.addObject("theme", "light");
    modelAndView.getModel().put("imsVersion", "1.0");
  }
}
`;
  const file = parseJavaFile(INTERCEPTOR, `C:/src/LayoutHandler.java`);
  const interceptor = file.types[0];

  test(`collects global attributes without session constants marking the model dynamic`, () => {
    expect(interceptor.isInterceptor).toBe(true);
    expect(interceptor.isController).toBe(false);
    expect(interceptor.handlers).toEqual([]);
    expect(interceptor.classAttributes.map((attribute) => attribute.name)).toEqual([`loginUser`, `theme`, `imsVersion`]);
    expect(interceptor.dynamicModel).toBe(false);
  });

  test(`infers interceptor attribute types`, () => {
    const loginUser = parseJavaFile(`package com.example; public class Login { public record LoginUser(String empNm, String deptNm) {} }`, `C:/src/Login.java`).types.find((type) => type.name === `LoginUser`);
    resolveAttributeTypes(file, INTERCEPTOR, (name) => (name === `LoginUser` ? loginUser : undefined));
    const byName = new Map(interceptor.classAttributes.map((attribute) => [attribute.name, attribute.typeName]));
    expect(byName.get(`loginUser`)).toBe(`LoginUser`);
    expect(byName.get(`theme`)).toBe(`String`);
  });
});

// 5. REST 핸들러·배열 경로 ----------------------------------------------------
describe(`parseJavaFile rest and array paths`, () => {
  const REST = `package com.example.api;
@RestController
@RequestMapping(value={"/api/emp"}, produces={JSON_VALUE})
public class EmpController {
  @GetMapping(value={"/codes"})
  public HttpBody findCodes() {
    return httpOk("done", service.findCodes());
  }
  @PostMapping(value={"/excel"}, consumes={JSON_VALUE})
  public void writeExcel(@RequestBody EmpList request, HttpServletResponse response) {
  }
  private String maskEmail(String email) {
    return "%s***".formatted(email);
  }
}
`;
  const PAGE = `package com.example.web;
@Controller
public class MenuController {
  @GetMapping(value={"/page/{group}/{program}"})
  public String showProgram(@PathVariable("group") String group, Model model) {
    model.addAttribute("contentView", "pages/%s".formatted(group));
    return "common/main";
  }
  @GetMapping("/dynamic")
  public String showDynamic(String name) {
    return "pages/" + name;
  }
  @GetMapping("/choice")
  public String showChoice(boolean wide) {
    return wide ? "pages/wide" : "pages/narrow";
  }
  @ResponseBody
  @GetMapping("/ping")
  public String ping() {
    return "pong";
  }
}
`;
  const rest = parseJavaFile(REST, `C:/src/EmpController.java`).types[0];
  const page = parseJavaFile(PAGE, `C:/src/MenuController.java`).types[0];

  test(`indexes rest handler paths without views or model attributes`, () => {
    expect(rest.isRestController).toBe(true);
    expect(rest.isController).toBe(false);
    expect(rest.classPaths).toEqual([`/api/emp`]);
    expect(rest.handlers.map((handler) => [handler.methodName, handler.paths, handler.viewNames.length, handler.attributes.length])).toEqual([[`findCodes`, [`/api/emp/codes`], 0, 0], [`writeExcel`, [`/api/emp/excel`], 0, 0]]);
  });

  test(`parses array path literals containing braces`, () => {
    expect(page.handlers[0].paths).toEqual([`/page/{group}/{program}`]);
    expect(page.handlers[0].viewNames.map((view) => view.name)).toEqual([`common/main`]);
  });

  test(`takes only literal or conditional-literal returns as view names`, () => {
    const byMethod = new Map(page.handlers.map((handler) => [handler.methodName, handler.viewNames.map((view) => view.name)]));
    expect(byMethod.get(`showDynamic`)).toEqual([]);
    expect(byMethod.get(`showChoice`)).toEqual([`pages/wide`, `pages/narrow`]);
    expect(byMethod.get(`ping`)).toEqual([]);
  });
});
