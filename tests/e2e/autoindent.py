# Enter's indentation: after ":", after an open bracket (a definition's
# parameters, a constructor's fields, a list), between a bracket and its
# closer, under the first thing after a bracket, back after a line that
# closed brackets opened above; brackets in comments and strings ignored.
import time
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
# | is the caret; what Enter gives
CASES = [
    ("after :", "def f() -> Nat:|", "def f() -> Nat:\n  |"),
    ("def header", "def f(|", "def f(\n  |"),
    ("between ( and )", "def f(|) -> Nat:", "def f(\n  |\n) -> Nat:"),
    ("a parameter, then the next", "def f(\n  x: Nat,|", "def f(\n  x: Nat,\n  |"),
    ("after the closing ) line", "def f(\n  x: Nat\n) -> Nat:|", "def f(\n  x: Nat\n) -> Nat:\n  |"),
    ("constructor fields aligned", "  t = Node{left: Tree,|", "  t = Node{left: Tree,\n           |"),
    ("constructor declaration", "type T is Data:\n  Node{|", "type T is Data:\n  Node{\n    |"),
    ("between { and }", "  Leaf{|}", "  Leaf{\n    |\n  }"),
    ("list", "  xs = [|", "  xs = [\n    |"),
    ("call aligned", "  y = f(a,|", "  y = f(a,\n        |"),
    ("back after a closed call", "  y = f(a,\n        b)|", "  y = f(a,\n        b)\n  |"),
    ("comment brackets ignored", "  # see (this|", "  # see (this\n  |"),
    ("string brackets ignored", "  s = \"(\"|", "  s = \"(\"\n  |"),
    ("plain line", "    x = 1|", "    x = 1\n    |"),
]
with sync_playwright() as p:
    b = p.chromium.launch()
    for touch in [False, True]:
        ctx = b.new_context(viewport={"width": 390 if touch else 1280, "height": 800}, locale="en-US", is_mobile=touch, has_touch=touch)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1)
        bad = 0
        for label, before, want in CASES:
            text = before.replace("|", "")
            at = before.index("|")
            page.evaluate("""([text, at]) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select();
              document.execCommand('insertText', false, text); ta.setSelectionRange(at, at); }""", [text, at])
            page.keyboard.press("Enter")
            got = page.evaluate("() => { const ta = document.querySelector('#ed-ta'); return ta.value.slice(0, ta.selectionStart) + '|' + ta.value.slice(ta.selectionEnd); }")
            ok = got == want
            bad += not ok
            print(("ok   " if ok else "!! FAIL ") + ("touch " if touch else "") + label, "" if ok else repr(got) + " want " + repr(want))
        page.keyboard.press("Control+z")
        undone = page.evaluate("document.querySelector('#ed-ta').value")
        print(("ok   " if undone == CASES[-1][1].replace("|", "") else "!! FAIL ") + "one Undo takes the line break back", repr(undone))
        for e in errs: print("!!", e[:300])
        ctx.close()
    b.close()
