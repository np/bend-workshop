import time, os, json
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def code(page): return page.evaluate("document.querySelector('#ed-ta').value")
def rows(page, nth=0):
    card = page.locator(".goal").nth(nth)
    return [(r.locator(".goal-var").inner_text(), r.locator("input").is_checked(), r.locator("input").is_disabled()) for r in card.locator(".goal-body .pick").all()]
import re
def tick(page, k):
    page.locator(".goal-body .pick").filter(has=page.locator(".goal-var", has_text=re.compile("^" + k + "$"))).locator("input").check(); time.sleep(0.2)
def open_lemma(page, nth=0):
    page.locator(".goal").nth(nth).locator(".goal-head .chip", has_text="Lemma").click(); time.sleep(0.3)
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)

    # 1. the step of x + 0 = x: the goal names p
    set_code(page, "import Base\n\n# LAW: x + 0 = x\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\n# PROOF\ndef add_zero(x):\n  match x:\n    case 0n:\n      {==}\n    case 1n+p:\n      ?step\n")
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.2)
    open_lemma(page)
    print("1 rows:", rows(page), "| name:", page.locator(".lemma-name").input_value())
    page.locator(".goal-head .chip", has_text="Extract").click(); time.sleep(1.5)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000)
    print("1 text:\n" + code(page))
    print("1 verdict:", page.inner_text("#verdict-text"), "| cards:", [x.split("\n")[0] for x in page.locator(".goal").all_inner_texts()])

    # 2. quantities, and a hypothesis the goal does not name, ticked by hand
    set_code(page, "import Base\n\ndef f(-A: Type, +n: Nat, x: A, xs: List<A>, h: {n == 0n : Nat}) -> {Nat.add(n, 0n) == n : Nat}:\n  ?g\n")
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.2)
    open_lemma(page)
    print("2 rows before:", rows(page))
    tick(page, "h")
    print("2 rows after ticking h:", rows(page))
    page.fill(".lemma-name", "n_zero"); page.locator(".goal-head .chip", has_text="Extract").click(); time.sleep(1.5)
    print("2 text:\n" + code(page))
    print("2 verdict:", page.inner_text("#verdict-text"))

    # 3. in PROOF.bend of the sort demo: imported names, a function hypothesis
    root = "../bend/demos/proof_insertion_sort"
    files = [{"name": n, "text": open(root + "/" + n).read()} for n in ["main.bend", "LAWS.bend", "PROOF.bend"]]
    files[2]["text"] = files[2]["text"].replace("      (lh, rec(st, e))", "      ?here")
    page2 = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    page2.on("pageerror", lambda e: errs.append(str(e)))
    page2.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v2', " + json.dumps(json.dumps({"current": "x", "order": ["x"], "live": True, "size": 14, "lang": "en"})) + "); localStorage.setItem('bend-play:p:x', " + json.dumps(json.dumps({"id": "x", "name": "sort", "files": files, "active": 2, "args": ""})) + "); }")
    page2.goto("http://localhost:8123/index.html"); page2.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.5)
    open_lemma(page2)
    print("3 rows:", rows(page2))
    for k in ["rec", "lh", "st", "e"]:
        tick(page2, k)
    print("3 rows ticked:", rows(page2))
    page2.locator(".goal-head .chip", has_text="Extract").click(); time.sleep(2.0)
    c2 = page2.evaluate("document.querySelector('#ed-ta').value")
    i = c2.index("def here(")
    print("3 lemma:\n" + c2[i - 2:i + 420])
    print("3 call:", [l.strip() for l in c2.split("\n") if "here(" in l and not l.startswith("def")])
    print("3 verdict:", page2.inner_text("#verdict-text"))
    for e in errs: print("!!", e[:300])
    b.close()
