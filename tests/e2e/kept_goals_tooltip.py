import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
PROG = '''import Base

law add_zero:
  for x: Nat
  {Nat.add(x, 0n) == x : Nat}

def add_zero(x):
  match x:
    case 0n:
      ?base
    case 1n+p:
      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      ?step

def twice(n: Nat) -> Nat:
  Nat.add(n, ?other)
'''
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def cards(page):
    return [t.split("\n")[0] + " [" + t.split("\n")[1] + "]" for t in page.locator(".goal").all_inner_texts()]

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(locale="fr-FR", viewport={"width": 1280, "height": 800}).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html")
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    set_code(page, PROG)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000)
    print("1:", page.inner_text("#verdict-text"), cards(page))
    # not pinned: a wrong term in place of ?step keeps the card
    set_code(page, PROG.replace("      ?step", "      add_zero(p)"))
    page.wait_for_selector("#verdict[data-state=bad]", timeout=30000)
    print("2 wrong term:", cards(page))
    # half-typed (parse error) keeps it too
    set_code(page, PROG.replace("      ?step", "      {="))
    time.sleep(1.2)
    print("3 parse error:", page.inner_text("#verdict-text")[:50], cards(page))
    # the right term: the card goes, others stay
    set_code(page, PROG.replace("      ?step", "      {==}"))
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000)
    time.sleep(0.5)
    print("4 right term:", page.inner_text("#verdict-text"), cards(page))
    # jump to a goal selects the hole
    page.locator("button.goal-name", has_text="?other").click()
    sel = page.evaluate("(() => { const ta = document.querySelector('#ed-ta'); return ta.value.slice(ta.selectionStart, ta.selectionEnd); })()")
    print("5 jump selects:", repr(sel))
    # hover tooltip over Nat.add
    box = page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); const r = ta.getBoundingClientRect(); const lines = ta.value.split('\\n'); const li = lines.findIndex(l => l.includes('Nat.add(n')); const col = lines[li].indexOf('Nat.add') + 2;
      const cs = getComputedStyle(document.documentElement); const lh = parseFloat(cs.getPropertyValue('--code-lh')); const probe = document.createElement('span'); probe.textContent = 'M'.repeat(50); probe.style.cssText='position:absolute;visibility:hidden;white-space:pre'; document.querySelector('#ed-hl').append(probe); const chw = probe.getBoundingClientRect().width/50; probe.remove();
      return { x: r.left + 12 + (col + 0.5) * chw, y: r.top + 12 + (li + 0.5) * lh }; }""")
    page.mouse.move(box["x"] - 3, box["y"]); page.mouse.move(box["x"], box["y"])
    time.sleep(0.7)
    print("6 tooltip:", page.evaluate("document.querySelector('#tip').hidden"), "|", page.inner_text("#tip").replace("\n", " / ")[:160])
    page.screenshot(path=shot("shot_g4.png"))
    # PROOF demo: a hole in PROOF.bend seen from main.bend
    page.mouse.move(5, 5)
    page.click("#btn-examples"); page.click(".ex:has-text('Tri par insertion')")
    page.wait_for_selector("#laws[data-state=ok]", timeout=30000)
    page.click(".file:has-text('PROOF.bend')"); time.sleep(0.5)
    code = page.evaluate("document.querySelector('#ed-ta').value")
    lines = code.split("\n")
    idx = max(i for i, l in enumerate(lines) if l.strip() == "{==}")
    lines[idx] = lines[idx].replace("{==}", "?ici")
    set_code(page, "\n".join(lines))
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000)
    print("7 proof goal:", page.inner_text("#verdict-text"), "|", [t.replace("\n", " / ")[:200] for t in page.locator(".goal").all_inner_texts()])
    page.click(".file:has-text('main.bend')")
    page.wait_for_selector("#laws[data-state=goal]", timeout=30000)
    print("8 from main:", page.inner_text("#laws"), "|", cards(page))
    for e in errs: print("err", e[:300])
    b.close()
