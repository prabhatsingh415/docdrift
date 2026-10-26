package demo;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/")
public class Const {

    @GetMapping("/users")
    public String users() { return "ok"; }

    @GetMapping(Constants.ORDERS)
    public String orders() { return "ok"; }
}