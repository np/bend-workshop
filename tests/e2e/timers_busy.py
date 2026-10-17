# The JS loop (since 2.0.35) fires a due timer while computations keep it busy
# (Bend's tests/io/within_busy.bend): run as is (official loop, in a worker),
# then with a window open first (the page's async loop for windows).
import time, json
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
base = open("../bend/tests/io/within_busy.bend").read()
plain = base
win = base.replace('''def main() -> IO(Unit):
  IO.bind(Chan(Nat), Unit, Chan.new(Nat, 0), go)''', '''def with_win(r: Result<&1, &1, U32 & String, Window>) -> IO(Unit):
  match r:
    case Fail{e}:
      IO.print("no window")
    case Done{w}:
      do IO<Unit>:
        IO.bind(Chan(Nat), Unit, Chan.new(Nat, 0), go)
        Window.close(w)

def main() -> IO(Unit):
  IO.bind(Result<&1, &1, U32 & String, Window>, Unit, Window.open("busy", 64, 64), with_win)''')
with sync_playwright() as p:
    b = p.chromium.launch()
    for label, code, init in [("plain, worker", plain, None), ("window, worker", win, None), ("window, page", win, "delete window.Worker;")]:
        page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        if init: page.add_init_script(init)
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
        page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
        time.sleep(1.5)
        state = page.get_attribute("#verdict", "data-state")
        page.click("#run")
        for _ in range(240):
            log = page.locator("#log").inner_text()
            if "pipeline done" in log or "Error" in log or "no window" in log: break
            time.sleep(0.25)
        time.sleep(0.5)
        lines = [l for l in page.locator("#log").inner_text().split("\n") if l.strip()]
        seen = [l for l in lines if l in ("deadline", "slept", "pipeline done", "no window")]
        print(label.ljust(16), "| verdict:", state, "| output:", seen, "|", lines[-1][:70])
        assert "deadline" in seen and "pipeline done" in seen, label + ": the loop did not fire the timer and finish"
        for e in errs: print("!!", e[:200])
        page.close()
    b.close()
