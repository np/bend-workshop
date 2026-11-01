# Type applications in the signature bar, as calls are: the parameter of
# the argument at hand in bold, for a type of the project and for Base's
# (whose kinds hold <&> and ->); a type's sheet: go to its definition,
# rename, move, and no law⇄def.
import time
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
CODE = """import Base

type Duo<-A: Type, -B: Type> is Type:
  Duo{fst: A, snd: B}

def ei(e: Either<Nat, Bool>, r: Result<String, Nat>, s: Sigma<Nat, x => Bool>, d: Duo<Nat, Bool>) -> Nat:
  ?k
"""
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
def at(page, needle, off):
    code = page.evaluate("document.querySelector('#ed-ta').value")
    pos = code.index(needle) + off
    page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos); time.sleep(0.3)
    return page.locator(".sig-row").first.inner_text().replace("\n", " | "), page.locator(".sig-row").first.locator("b").all_inner_texts()
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", CODE); time.sleep(1)
    row, bold = at(page, "Either<Nat, Bool>", 13)
    check("1 Either, second:", row, bold, "is Kind(a <&> b) | Base" in row, bold == ["-B: Kind(b)"])
    row, bold = at(page, "Result<String, Nat>", 8)
    check("2 Result, first:", bold, bold == ["-E: Kind(a)"])
    row, bold = at(page, "Sigma<Nat, x", 11)
    check("3 Sigma, after a lambda:", bold, bold == ["-B: @-x: A -> Kind(b)"])
    row, bold = at(page, "Duo<Nat, Bool>", 9)
    check("4 a project type:", row, bold == ["-B: Type"])
    page.locator(".sig-row").first.click(); time.sleep(0.4)
    btns = page.locator(".sheet .btn").all_inner_texts()
    check("5 its sheet:", btns, "Go to the definition" in btns, "Rename" in btns, not any("law" in x for x in btns))
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
