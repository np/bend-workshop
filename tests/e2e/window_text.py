# Typed text reaches a window as Text events (Bend 2.0.37), beside the Key
# events: a window that prints the first Text it gets, then closes. In a
# worker, then on the page without workers (the cooperative loop).
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
PROG = 'import Base\n\ndef scan(evs: List<Event>) -> Maybe<String>:\n  match evs:\n    case []:\n      None{}\n    case e <> rest:\n      match e:\n        case Text{t}:\n          Some{t}\n        case other:\n          scan(rest)\n\ndef T.view(s: U32) -> U32 & Image:\n  (s, Pix{255})\n\ndef T.typed(s: U32, found: Maybe<String>) -> IO(Maybe<U32>):\n  match found:\n    case Some{t}:\n      do IO<Maybe<U32>>:\n        IO.print("typed " ++ t)\n        IO.pure(Maybe<U32>, None{})\n    case None{}:\n      IO.pure(Maybe<U32>, Some{s})\n\ndef T.tick(evs: List<Event>, s: U32) -> IO(Maybe<U32>):\n  T.typed(s, scan(evs))\n\ndef main() -> IO(Unit):\n  App.run(~U32, ~App{T.view, T.tick}, "Text", 64, 64, 0)\n'
with sync_playwright() as p:
    b = p.chromium.launch()
    for label, init in [("worker", None), ("page", "delete window.Worker;")]:
        page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        if init: page.add_init_script(init)
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
        page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", PROG)
        time.sleep(1.5)
        page.click("#run")
        page.wait_for_selector(".tab[data-tab=screen]:not([hidden])", timeout=60000); time.sleep(1.0)
        page.locator("#screen").click(); time.sleep(0.2)
        page.keyboard.press("q")
        for _ in range(80):
            log = page.locator("#log").inner_text()
            if "typed" in log: break
            time.sleep(0.25)
        lines = [l for l in page.locator("#log").inner_text().split("\n") if l.strip()]
        typed = [l for l in lines if l.startswith("typed")]
        print(label.ljust(7), "| output:", typed, "|", lines[-1][:70])
        assert typed == ["typed q"], label + ": no Text event"
        for e in errs: print("!!", e[:200])
        page.close()
    b.close()
