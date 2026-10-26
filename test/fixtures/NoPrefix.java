package fixtures;

@RestController
public class NoPrefix {

    @GetMapping("/health")
    public String health() { return "ok"; }

    @PostMapping("/items")
    public String createItem() { return "ok"; }
}