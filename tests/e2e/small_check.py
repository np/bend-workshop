# Small check of a law: its sheet's "Try on small values" and the agent's
# small_check. A law that holds, one false (its counterexample), one with a
# hypothesis (cases where it is false do not count), a list, a type of the
# file, a function binder (refused, said why); a hole below the laws does
# not matter.
import os, time, json
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
MOCK = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_claude.py")).read().split('MOCK = """', 1)[1].split('"""', 1)[0]
MOCK = MOCK.replace(".slice(0, 220)", ".slice(0, 3000)")
CODE = """import Base

type Shape is Data:
  Circle{r: Nat}
  Square{s: Nat}

def area(s: Shape) -> Nat:
  match s:
    case Circle{r}: Nat.add(r, 1n)
    case Square{s}: s

law add_zero:
  for x: Nat
  {Nat.add(x, 0n) == x : Nat}

law bad:
  for x: Nat
  for y: Nat
  {Nat.add(x, y) == x : Nat}

law hyp:
  for x: Nat
  {x == 0n : Nat} -> {Nat.add(x, x) == 0n : Nat}

law rev:
  for xs: List<&2, Nat>
  {List.reverse(&2, Nat, List.reverse(&2, Nat, xs)) == xs : List<&2, Nat>}

law shape:
  for s: Shape
  {area(s) == 1n : Nat}

law fun:
  for f: Nat -> Nat
  {f(0n) == f(0n) : Nat}

def later(x: Nat) -> Nat:
  ?later
"""
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[str(m)[:300] for m in more])
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 390, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", CODE)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.5)
    def sheet(law):
        pos = page.evaluate("(n) => document.querySelector('#ed-ta').value.indexOf('law ' + n + ':') + 5", law)
        page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos); time.sleep(0.4)
        page.locator(".sig-row").first.click(); time.sleep(0.3)
        page.locator(".sheet .btn", has_text="Try on small values").click()
        page.wait_for_selector(".small-check .sc-held, .small-check .sc-false, .small-check .sc-why", timeout=30000)
        txt = page.inner_text(".small-check")
        page.click(".sheet-head button"); time.sleep(0.2)
        return txt
    t = sheet("add_zero"); check("add_zero holds in 4 cases", "Held in all 4 cases" in t, t)
    t = sheet("bad"); check("bad is false, x = 0n, y = 1n", "False" in t and "x = 0n" in t and "y = 1n" in t, t)
    t = sheet("hyp"); check("hyp: 1 case, 3 where the hypothesis is false", "Held in all 1 cases" in t and "3 more" in t, t)
    t = sheet("rev"); check("rev holds on lists", "Held in all" in t and "[1n, 0n]" in t, t)
    t = sheet("shape"); check("shape is false, a Circle", "False" in t and "Circle" in t, t)
    t = sheet("fun"); check("a function binder: said why", "No small values" in t and "f" in t, t)
    # the agent's tool
    page.set_viewport_size({"width": 1280, "height": 800})
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4); page.click(".sheet-head button")
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.evaluate("""window.__plan = [[['small_check', {law: 'bad'}], ['small_check', {law: 'add_zero'}], ['small_check', {law: 'nope'}]]]""")
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=60000); time.sleep(0.3)
    log = page.evaluate("window.__seen")[0]["log"]
    for l in log: print("  ", l[:300])
    check("agent: false with the counterexample", '"verdict": "false"' in log[0] and '"y": "1n"' in log[0], log[0])
    check("agent: held", "held on small values" in log[1] and '"cases": 4' in log[1], log[1])
    check("agent: no such law", "Error" in log[2], log[2])
    for e in errs: print("!!", e[:300])
    b.close()
