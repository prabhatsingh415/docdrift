package fixtures;

@RestController
@RequestMapping("/api/users")
public class WithPrefix {

    @GetMapping
    public String list() {
        return "ok";
    }

    @GetMapping("/{id}")
    public String get() {
        return "ok";
    }

    @PostMapping(value = "/create")
    public String create() {
        return "ok";
    }

    @DeleteMapping(path = "/{id}")
    public String delete() {
        return "ok";
    }
}