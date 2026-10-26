package fixtures;

@RestController
@RequestMapping("/multi")
public class MultiPath {

    @GetMapping({"/a", "/b"})
    public String ab() { return "ok"; }

    @RequestMapping(value = {"/c", "/d"}, method = RequestMethod.GET)
    public String cd() { return "ok"; }
}