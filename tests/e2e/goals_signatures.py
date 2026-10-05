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

def g(a: U32, b: U32, c: String) -> U32:
  a

def main() -> U32:
  g(?a, ?second, 42)
'''
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(locale="fr-FR", viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True, device_scale_factor=2).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html")
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    set_code(page, PROG)
    page.wait_for_selector("#verdict[data-state=bad]", timeout=30000)
    print("verdict:", page.inner_text("#verdict-text"))
    print("goals:", page.inner_text("#goals-count"), "|", [t.replace("\n", " / ") for t in page.locator(".goal").all_inner_texts()])
    print("mark:", repr(page.evaluate("document.querySelector('#ed-marks mark')?.textContent")))
    page.evaluate("document.querySelector('#ed').scrollTop = 0")
    page.screenshot(path=shot("shot_g1.png"))
    # fix the error: goals only
    set_code(page, PROG.replace("42)", '"x")'))
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000)
    print("verdict2:", page.inner_text("#verdict-text"))
    # pin ?step, then replace ?step by a wrong term: the card must stay
    page.locator(".goal", has_text="?step").locator(".pin").click()
    set_code(page, PROG.replace("42)", '"x")').replace("      ?step", "      add_zero(p)"))
    time.sleep(1.2)
    print("after edit:", page.inner_text("#goals-count"), "|", [t.split("\n")[0] for t in page.locator(".goal").all_inner_texts()])
    print("verdict3:", page.inner_text("#verdict-text"))
    page.screenshot(path=shot("shot_g2.png"))
    # signature bar: caret inside g( ... second arg
    code = page.evaluate("document.querySelector('#ed-ta').value")
    pos = code.index("?second") + 3
    page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos)
    time.sleep(0.3)
    print("sig rows:", [t.replace("\n", " | ") for t in page.locator(".sig-row").all_inner_texts()], "| active:", page.evaluate("document.querySelector('.sig .arg')?.textContent"))
    pos = code.index("Nat.add(x") + 5
    page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos)
    time.sleep(0.3)
    print("sig Nat.add:", [t.replace("\n", " | ") for t in page.locator(".sig-row").all_inner_texts()])
    pos = code.index("add_zero(p)") + 3
    page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos)
    time.sleep(0.3)
    print("sig law:", [t.replace("\n", " | ") for t in page.locator(".sig-row").all_inner_texts()])
    pos = code.index("  a\n") + 3
    page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos)
    time.sleep(0.3)
    print("sig param:", [t.replace("\n", " | ") for t in page.locator(".sig-row").all_inner_texts()])
    page.screenshot(path=shot("shot_g3.png"))
    for e in errs: print("err", e[:300])
    b.close()
