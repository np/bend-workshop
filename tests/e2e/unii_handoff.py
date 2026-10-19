# The hand-over to UniiChat: the message (task, files in fenced blocks with
# path=, the bend CLI, the memory), copied and UniiChat opened; its answer
# pasted back: the files it gives taken back, a new one created, Undo. With
# no assistant set up, at phone size.
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
ANSWER = """Done: ALL PROOFS CHECK, and `bend main.bend --verdict` agrees.

```bend path=main.bend
import Base

def main() -> U32:
  42
```

```bend path=lib.bend
import Base

def seven() -> U32:
  7
```
"""
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 800}, locale="en-US", is_mobile=True, has_touch=True)
    ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script("window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; };")
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1)
    page.evaluate("document.querySelector('.tab[data-tab=agent]').hidden = false")
    page.click("#chev"); time.sleep(0.2); page.locator(".tab[data-tab=agent]").scroll_into_view_if_needed(); page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.locator("#pane-agent .btn", has_text="UniiChat").click(); time.sleep(0.3)
    msg = page.eval_on_selector(".sheet textarea[readonly]", "t => t.value")
    check("1 message:", "Task: " in msg, "```bend path=main.bend" in msg, "bend-lang.com/install.sh" in msg, "path=<its path>" in msg)
    page.locator(".sheet .btn", has_text="Copy, and open").click(); time.sleep(0.3)
    clip = page.evaluate("navigator.clipboard.readText()")
    check("2 copied, UniiChat opened:", clip == msg, page.evaluate("window.__opened") == ["https://uniichat.com"])
    page.screenshot(path=shot("shot_unii_sheet.png"))
    page.fill(".sheet textarea:not([readonly])", ANSWER); time.sleep(0.2)
    note = page.inner_text(".sheet small")
    page.locator(".sheet .btn", has_text="Take the files back").click(); time.sleep(0.5)
    files = page.eval_on_selector_all(".file", "xs => xs.map(x => x.dataset.name)")
    text = page.eval_on_selector("#ed-ta", "t => t.value")
    check("3 taken back:", note, files == ["main.bend", "lib.bend"], "42" in text)
    page.locator(".toast button", has_text="Undo").click(); time.sleep(0.4)
    files = page.eval_on_selector_all(".file", "xs => xs.map(x => x.dataset.name)")
    check("4 undone:", files == ["main.bend"], "42" not in page.eval_on_selector("#ed-ta", "t => t.value"))
    for e in errs: print("!!", e[:200])
    b.close()
