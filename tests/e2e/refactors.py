# Moving around and reshaping a project: the caret comes back where it was
# in each file (across a reload too); the constructors of an imported type
# are offered as the file must write them (S.Circle{..}); a def renamed
# everywhere; a def moved to another module, its uses and imports
# following; a move that would make the imports go round, refused with the
# reason. Phone size, touch.
import json, time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
SHAPES = """import Base

# A shape.
type Shape is Data:
  Circle{r: Nat}
  Square{s: Nat}

def Shape.size(x: Shape) -> Nat:
  match x:
    case Circle{+r}:
      r
    case Square{+s}:
      s

def double(+n: Nat) -> Nat:
  Nat.add(n, n)

# Twice the size.
def big(x: Shape) -> Nat:
  double(Shape.size(x))
"""
UTIL = "import Base\n\ndef triple(+n: Nat) -> Nat:\n  Nat.add(n, Nat.add(n, n))\n"
MAIN = """import Base
import ./shapes.bend as S

def area(x: S.Shape) -> Nat:
  S.big(x)

def mk() -> S.Shape:
  ?h

def main() -> Nat:
  area(S.Circle{3n})
"""
SEED = json.dumps({"files": [{"name": "main.bend", "text": MAIN}, {"name": "shapes.bend", "text": SHAPES}, {"name": "util.bend", "text": UTIL}],
                   "active": 0, "args": "", "live": True, "size": 15})

def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800}, locale="en-US", is_mobile=True, has_touch=True)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v1', %s); }" % json.dumps(SEED))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.5)
    tab = lambda name: page.click(".file[data-name='%s']" % name)
    text = lambda: page.eval_on_selector("#ed-ta", "t => t.value")
    caret_on = lambda needle, k=0: page.evaluate("""([n, k]) => { const t = document.querySelector('#ed-ta'); let i = -1;
      for (let j = 0; j <= k; j++) i = t.value.indexOf(n, i + 1); t.focus(); t.setSelectionRange(i + 1, i + 1);
      t.dispatchEvent(new Event('select')); document.dispatchEvent(new Event('selectionchange')); return i + 1; }""", [needle, k])

    # 1 the caret comes back where it was in each file
    at = caret_on("area(S.Circle")
    page.evaluate("document.querySelector('#ed-ta').blur()")
    tab("shapes.bend"); time.sleep(0.3)
    caret_on("double(Shape")
    page.evaluate("document.querySelector('#ed-ta').blur()")
    tab("main.bend"); time.sleep(0.3)
    back = page.eval_on_selector("#ed-ta", "t => t.selectionStart")
    tab("shapes.bend"); time.sleep(0.3)
    back2 = page.eval_on_selector("#ed-ta", "t => t.selectionStart")
    check("1 caret kept:", back == at, back2 == SHAPES.index("double(Shape") + 1)
    time.sleep(0.8)
    page.reload(); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    check("1 after a reload, in the file open last:", page.eval_on_selector("#ed-ta", "t => t.selectionStart") == back2)

    # 2 an imported type's constructors, as main.bend must write them
    tab("main.bend"); time.sleep(0.3)
    page.wait_for_selector(".goal", timeout=30000); time.sleep(1.0)
    btn = page.locator(".goal .chip", has_text="Constructors")
    btn.first.click(); page.wait_for_selector(".goal .cands .cand", timeout=30000); time.sleep(0.3)
    cands = page.locator(".goal .cands .cand").all_inner_texts()
    fits = page.locator(".goal .cands .cand.fits").count()
    check("2 constructors:", cands, any(c.startswith("S.Circle{") for c in cands), fits == 2)
    page.screenshot(path=shot("shot_refactor_ctors.png"))

    # 3 rename big everywhere
    tab("shapes.bend"); time.sleep(0.3)
    caret_on("def big", 0); page.evaluate("document.querySelector('#ed-ta').setSelectionRange(%d, %d)" % (SHAPES.index("def big") + 5, SHAPES.index("def big") + 5)); time.sleep(0.4)
    page.locator(".sig-row", has_text="big").first.click(); time.sleep(0.3)
    page.locator(".sheet .btn", has_text="Rename").first.click(); time.sleep(0.3)
    page.fill(".sheet input", "huge"); time.sleep(0.2)
    preview = page.inner_text(".sheet small")
    page.locator(".sheet .btn", has_text="Rename everywhere").click()
    page.wait_for_selector(".toast", timeout=30000); time.sleep(0.4)
    toast = page.inner_text(".toast")
    shapes_now = text()
    tab("main.bend"); time.sleep(0.3)
    check("3 rename:", preview, "huge" in toast, "def huge(" in shapes_now, "S.huge(x)" in text(), "S.big" not in text())

    # 4 move double to util.bend
    tab("shapes.bend"); time.sleep(0.3)
    i = text().index("def double") + 5
    page.evaluate("(i) => { const t = document.querySelector('#ed-ta'); t.focus(); t.setSelectionRange(i, i); }", i); time.sleep(0.4)
    page.locator(".sig-row", has_text="double").first.click(); time.sleep(0.3)
    page.locator(".sheet .btn", has_text="Move to").first.click(); time.sleep(0.3)
    page.select_option(".sheet select", "util.bend"); time.sleep(0.3)
    plan = page.inner_text(".sheet small")
    page.screenshot(path=shot("shot_refactor_move.png"))
    page.locator(".sheet .btn", has_text="Move").last.click()
    page.wait_for_selector(".toast:has-text('moved')", timeout=30000); time.sleep(0.5)
    shapes_now = text()
    tab("util.bend"); time.sleep(0.3)
    util_now = text()
    check("4 move:", plan.replace("\n", " / "), "def double(" not in shapes_now, "Util.double(" in shapes_now, "import ./util.bend as Util" in shapes_now,
          "def double(" in util_now)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)

    # 5 a move that would go round: Shape.size to util.bend (it uses Shape; huge, staying, uses it)
    tab("shapes.bend"); time.sleep(0.3)
    i = text().index("def Shape.size") + 6
    page.evaluate("(i) => { const t = document.querySelector('#ed-ta'); t.focus(); t.setSelectionRange(i, i); }", i); time.sleep(0.4)
    page.locator(".sig-row", has_text="Shape.size").first.click(); time.sleep(0.3)
    page.locator(".sheet .btn", has_text="Move to").first.click(); time.sleep(0.3)
    page.select_option(".sheet select", "util.bend"); time.sleep(0.3)
    why = page.inner_text(".sheet small")
    check("5 refused:", why, "circle" in why and "shapes.bend → util.bend → shapes.bend" in why)
    page.screenshot(path=shot("shot_refactor_cycle.png"))
    for e in errs: print("!!", e[:300])
    b.close()
