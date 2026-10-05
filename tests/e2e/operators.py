import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
CODE = "import Base\n\ndef f(a: U32, b: U32, x: F32, p: Bool, q: Bool, s: String, n: Nat) -> U32:\n  c = (a + b * 2 : U32)\n  d = (x / 2.0 : F32)\n  e = p && q\n  g = s ++ \"!\"\n  h = (n < 3n : Nat)\n  l = 1 <> []\n  (a % b : U32)\n"
def at(page, needle, off):
    code = page.evaluate("document.querySelector('#ed-ta').value")
    pos = code.index(needle) + off
    page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos); time.sleep(0.25)
    return [x.replace("\n", " | ") for x in page.locator(".sig-row").all_inner_texts()]
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", CODE); time.sleep(1)
    for needle, off, label in [("a + b", 2, "+ U32"), ("b * 2", 2, "* U32"), ("x / 2.0", 2, "/ F32"), ("p && q", 3, "&&"), ("s ++", 3, "++"), ("n < 3n", 2, "< Nat"), ("1 <> []", 3, "<>"), ("a % b", 2, "% U32")]:
        print(label, "→", at(page, needle, off))
    # an operator with no annotation: the stand-in and its sheet
    page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, 'import Base\\n\\ndef f(a: U32) -> U32:\\n  a + 1\\n'); }"""); time.sleep(0.8)
    print("no annotation →", at(page, "a + 1", 2))
    page.locator(".sig-row").first.click(); time.sleep(0.3)
    print("   sheet:", page.inner_text(".sheet-head h2"), "|", page.inner_text(".sigdoc")[:90], "|", page.locator(".sheet .btn").all_inner_texts()[:6])
    page.locator(".sheet .btn", has_text="U32.add").click(); time.sleep(0.3)
    print("   → U32.add sheet:", page.inner_text(".sheet-head h2"), "|", page.locator(".sheet .btn").all_inner_texts())
    page.click(".sheet-head button")
    # hover tooltip on an operator
    page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, 'import Base\\n\\ndef f(a: U32) -> U32:\\n  (a + 1 : U32)\\n'); }"""); time.sleep(0.8)
    page.evaluate("document.querySelector('#ed-ta').blur()")
    box = page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); const r = ta.getBoundingClientRect(); const probe = document.createElement('span'); probe.textContent = 'M'.repeat(50); probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'; document.querySelector('#ed-hl').append(probe); const chw = probe.getBoundingClientRect().width / 50; probe.remove(); const lh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--code-lh')); return { x: r.left + 12 + 5.5 * chw, y: r.top + 12 + 3.5 * lh }; }""")
    page.mouse.move(box["x"] - 2, box["y"]); page.mouse.move(box["x"], box["y"]); time.sleep(0.8)
    print("hover tip:", page.evaluate("document.querySelector('#tip').hidden ? null : document.querySelector('#tip').textContent.slice(0, 80)"))
    page.screenshot(path=shot("shot_ops.png"))
    for e in errs: print("!!", e[:200])
    b.close()
