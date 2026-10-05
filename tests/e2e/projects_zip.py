import time, json, io, zipfile, os, tempfile
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
URL = "http://localhost:8123/index.html"
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def code(page): return page.evaluate("document.querySelector('#ed-ta').value")
def name(page): return page.inner_text("#proj-name")
def others(page):
    page.click("#btn-proj"); time.sleep(0.2)
    r = [t.split("\n")[0] for t in page.locator(".proj-open").all_inner_texts()]
    page.click(".sheet-head button"); return r
def ok(page): page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)

with sync_playwright() as p:
    b = p.chromium.launch()
    # --- migration from the old single workspace
    ctx = b.new_context(locale="fr-FR", viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True, accept_downloads=True)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v1', JSON.stringify({files: [{name: 'main.bend', text: 'import Base\\n\\ndef main() -> U32:\\n  41\\n'}, {name: 'lib.bend', text: 'import Base\\n'}], active: 0, args: 'x', live: true, size: 15})); }")
    page.goto(URL); ok(page)
    print("1 migrated:", name(page), "|", repr(code(page)[-8:]), "| files:", page.locator(".file").count())

    # --- an example opens beside it, and leaves no trace unless edited
    page.click("#btn-examples"); page.click(".ex:has-text('FizzBuzz')"); ok(page)
    print("2 example:", name(page), "| others:", others(page))
    page.click("#btn-examples"); page.click(".ex:has-text('Fermetures')"); ok(page)
    print("3 next example:", name(page), "| others:", others(page))
    set_code(page, code(page) + "\n# touché\n"); time.sleep(0.6)
    page.click("#btn-examples"); page.click(".ex:has-text('Récursion')"); ok(page)
    print("4 after editing Fermetures:", name(page), "| others:", others(page))
    page.click(".toast button"); time.sleep(0.4)
    print("5 undo:", name(page), "| others:", others(page))

    # --- snapshots
    page.click("#btn-proj"); page.click(".proj-open:has-text('Mon projet')"); ok(page)
    set_code(page, "import Base\n\ndef main() -> U32:\n  42\n"); time.sleep(0.2); ok(page); time.sleep(0.8)
    set_code(page, "import Base\n\ndef main() -> U32:\n  \"cassé\"\n")
    page.wait_for_selector("#verdict[data-state=bad]", timeout=30000)
    page.click("#btn-proj"); page.click("summary"); time.sleep(0.2)
    print("6 snapshots:", [t.replace("\n", " | ") for t in page.locator(".snap").all_inner_texts()])
    page.screenshot(path=shot("shot_p1.png"))
    page.locator(".snap button").first.click(); ok(page)
    print("7 restored:", repr(code(page)[-6:]))

    # --- export, then import what was exported
    page.click("#btn-proj")
    with page.expect_download() as dl:
        page.click("text=Exporter en .zip")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename)
    dl.value.save_as(path)
    z = zipfile.ZipFile(path)
    print("8 export:", dl.value.suggested_filename, z.namelist(), "| testzip:", z.testzip(), "|", repr(z.read(z.namelist()[0]).decode()[-6:]))
    page.click("#btn-proj")
    with page.expect_file_chooser() as fc:
        page.click("text=Importer…")
    fc.value.set_files(path); time.sleep(0.8); ok(page)
    print("9 import of own zip:", name(page), "| files:", [t for t in page.locator(".file").all_inner_texts()])
    # a deflated zip made elsewhere, with a top folder and junk
    tmp = os.path.join(tempfile.mkdtemp(), "tri.zip")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zz:
        for n in ["main.bend", "LAWS.bend", "PROOF.bend"]:
            zz.write("../bend/demos/proof_insertion_sort/" + n, "tri/" + n)
        zz.writestr("tri/README.md", "x"); zz.writestr("__MACOSX/._main.bend", "x")
    page.click("#btn-proj")
    with page.expect_file_chooser() as fc:
        page.click("text=Importer…")
    fc.value.set_files(tmp); time.sleep(0.8); ok(page)
    print("10 import deflated:", name(page), "| files:", page.locator(".file").all_inner_texts(), "| laws:", page.inner_text("#laws") if not page.locator("#laws").is_hidden() else "-")

    # --- delete with undo, and persistence
    page.click("#btn-proj"); page.locator(".proj-row", has_text="FizzBuzz").locator("text=Supprimer").click() if page.locator(".proj-row", has_text="FizzBuzz").count() else None
    time.sleep(0.2); page.click(".sheet-head button") if page.locator(".sheet-head button").count() else None
    print("11 others now:", others(page))
    page.reload(); ok(page)
    print("12 after reload:", name(page), "| others:", others(page))
    keys = page.evaluate("Object.keys(localStorage).sort().map(k => k + ':' + localStorage.getItem(k).length)")
    print("13 storage:", keys)
    for e in errs: print("!!", e[:300])
    b.close()
