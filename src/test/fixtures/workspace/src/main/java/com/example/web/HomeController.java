package com.example.web;

import java.util.List;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import com.example.domain.Item;
import com.example.domain.User;
import com.example.service.ItemService;

/**
 * <pre>
 *
 * 홈 화면 컨트롤러
 *
 * - 목록·상세 템플릿 렌더링
 *
 * </pre>
 */
@Controller
@RequestMapping("/")
public class HomeController {

    private ItemService itemService;

    public HomeController(
        ItemService itemService
    ) {
        this.itemService = itemService;
    }

    // 1. 홈 목록 -----------------------------------------------------------------------
    @GetMapping("")
    public String home(
        Model model
    ) {
        List<Item> items = itemService.findAll();
        User user = itemService.currentUser();
        model.addAttribute("title", "Home");
        model.addAttribute("items", items);
        model.addAttribute("user", user);
        return "index";
    }

    // 2. 항목 상세 ----------------------------------------------------------------------
    @GetMapping("/items/{id}")
    public String detail(
        @PathVariable Long id,
        Model model
    ) {
        model.addAttribute("item", itemService.findOne(id));
        return "items/detail";
    }

    // 3. 존재하지 않는 뷰 -----------------------------------------------------------------
    @GetMapping("/broken")
    public String broken(
        Model model
    ) {
        model.addAttribute("user", itemService.currentUser());
        return "broken";
    }

    // 4. 미존재 템플릿 -----------------------------------------------------------------------
    @GetMapping("/missing")
    public String missing() {
        return "missing/view";
    }
}
