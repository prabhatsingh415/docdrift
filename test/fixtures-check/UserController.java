package demo;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class UserController {

    @GetMapping("/users")
    public String list() { return "ok"; }

    @PostMapping("/users")
    public String create() { return "ok"; }

    @DeleteMapping("/users/{id}")
    public String remove() { return "ok"; }
}