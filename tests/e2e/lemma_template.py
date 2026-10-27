# A lemma out of a def with a template parameter: the goal names it
# map_len~f, the lemma takes it as ~f (first, typed as the def types it),
# writes the goal with ~f, and the hole calls it with ~f.
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
CODE = """import Base

def map(~f: Nat -> Nat, xs: List<Nat>) -> List<Nat>:
  match xs:
    case []:
      []
    case x <> rest:
      f(x) <> map(~f, rest)

def map_len(~f: Nat -> Nat, xs: List<Nat>) -> {List.length(&1, Nat, map(~f, xs)) == List.length(&1, Nat, xs) : Nat}:
  match xs:
    case []:
      {==}
    case x <> rest:
      ?step
"""
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", CODE)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.6)
    page.evaluate("document.querySelector('#ed-ta').blur()")
    page.locator(".goal-head .chip", has_text="Lemma").first.click(); time.sleep(0.3)
    page.locator(".goal-head .chip", has_text="Extract").click(); time.sleep(2.0)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.5)
    text = page.eval_on_selector("#ed-ta", "t => t.value")
    head = [l for l in text.split("\n") if l.startswith("def step")]
    check("1 lemma:", head, len(head) == 1 and head[0].startswith("def step(~f: Nat -> Nat, rest: List<&1, Nat>)"), "map(~f, rest)" in text,
          "map_len~f" not in text, "      step(~f, rest)" in text, page.inner_text("#verdict-text")[:12])
    page.evaluate("document.querySelector('#ed-ta').focus()"); page.keyboard.press("Control+z"); time.sleep(0.3)
    check("2 Ctrl+Z takes the lemma back:", page.eval_on_selector("#ed-ta", "t => t.value") == CODE)
    for e in errs: print("!!", e[:200])
    b.close()
