package demo;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class DuplicateController {

    @GetMapping("/users")
    public String users() { return "ok"; }

    @PostMapping("/items")
    public String items() { return "ok"; }
}