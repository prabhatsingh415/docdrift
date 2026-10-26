package fixtures;

@RestController
@RequestMapping("/ghosts")
public class Commented {

    // @GetMapping("/gone")
    // public String gone() { return "ok"; }

    /*
     * @PostMapping("/also-gone")
     * public String alsoGone() { return "ok"; }
     */

    @GetMapping("/real")
    public String real() { return "ok"; }
}