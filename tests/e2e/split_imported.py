# Splitting on a type from another module: imported as S (S.Circle{..}),
# and reached only through another module (PROOF.bend imports LAWS.bend,
# which imports shapes.bend): then the checker prints shapes.Shape and the
# split adds the import its constructors need. One variable: at once.
import json, time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
SHAPES = "import Base\n\ntype Shape is Data:\n  Circle{r: Nat}\n  Square{s: Nat}\n\ndef area(x: Shape) -> Nat:\n  match x:\n    case Circle{+r}:\n      r\n    case Square{+s}:\n      s\n"
LAWS = "import Base\nimport ./shapes.bend as S\n\nlaw area_same:\n  for x: S.Shape\n  {S.area(x) == S.area(x) : Nat}\n"
PROOF = "import Base\nimport ./LAWS.bend as L\n\ndef L.area_same(x):\n  ?h\n"
MAIN = "import Base\nimport ./shapes.bend as S\n\ndef f(x: S.Shape) -> Nat:\n  ?g\n"
SEED = json.dumps({"files": [{"name": "PROOF.bend", "text": PROOF}, {"name": "LAWS.bend", "text": LAWS}, {"name": "shapes.bend", "text": SHAPES},
                             {"name": "main.bend", "text": MAIN}], "active": 0, "args": "", "live": True, "size": 15})
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 390, "height": 800}, locale="en-US", is_mobile=True, has_touch=True).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v1', %s); }" % json.dumps(SEED))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1)
    page.locator(".goal-head .chip", has_text="Split").first.click(); time.sleep(1.0)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.5)
    text = page.eval_on_selector("#ed-ta", "t => t.value")
    check("1 through LAWS:", "import ./shapes.bend as Shapes" in text, "case Shapes.Circle{r}:" in text, "case Shapes.Square{s}:" in text,
          page.inner_text("#verdict-text")[:14])
    page.click(".file[data-name='main.bend']"); time.sleep(0.3)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.5)
    page.locator(".goal-head .chip", has_text="Split").first.click(); time.sleep(1.0)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000)
    text = page.eval_on_selector("#ed-ta", "t => t.value")
    check("2 imported as S:", "case S.Circle{r}:" in text, "case S.Square{s}:" in text, text.count("import") == 2)
    page.screenshot(path=shot("shot_split_imported.png"))
    for e in errs: print("!!", e[:200])
    b.close()
