# The signature bar on a call of a parameter: a function, a motive, a
# continuation (proof code calls its parameters all the time), with a
# header over several lines; the argument at hand bold in its arrow type.
# A type's own parameters, its header over several lines, called in its
# constructors.
import time
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
CODE = """import Base

def T(b: Bool) -> Type:
  match b:
    case True{}: Unit
    case False{}: Empty

def and_split(+a: Bool, -b: Bool, w: Unit, -P: Type,
  f: T(a) -> Unit -> P) -> P:
  match a:
    case True{}:
      f(Unit{}, w)
    case False{}:
      ?h

type Cert<-A: Data, -s: A -> Nat,
  -a: Nat> is Data:
  Cert{proof: A, src: {a == s(proof) : Nat}}

def use_cert(c: Cert<Nat, x => 0n, 0n>) -> Nat:
  0n
"""
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *more)
def at(page, needle, off):
    code = page.evaluate("document.querySelector('#ed-ta').value")
    pos = code.index(needle) + off
    page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos); time.sleep(0.3)
    rows = page.locator(".sig-row")
    if rows.count() == 0:
        return "", []
    return rows.first.inner_text().replace("\n", " | "), rows.first.locator("b").all_inner_texts()
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", CODE); time.sleep(1.0)
    text, bold = at(page, "f(Unit{}, w)", 2)
    check("a parameter called: its type, the first argument bold", "f: T(a) -> Unit -> P" in text.replace(" | ", " ") and bold == ["T(a)"], text, bold)
    text, bold = at(page, "f(Unit{}, w)", 10)
    check("the second argument", bold == ["Unit"], text, bold)
    text, bold = at(page, "s(proof)", 2)
    check("a type's parameter, its header over two lines", "s: A -> Nat" in text and bold == ["A"], text, bold)
    text, bold = at(page, "Cert<Nat, x => 0n, 0n>", 20)
    check("the type's row: all its parameters, the third bold", "-a: Nat" in text and bold == ["-a: Nat"], text, bold)
    for e in errs: print("!!", e[:300])
    b.close()
