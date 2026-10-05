# Bend 2 pocket workshop

Write, check, prove and run [Bend 2](https://bend-lang.com) programs in the
browser, on a phone as well as a desktop. Bend's own checker and compilers
run inside one HTML page: no server, no install.

- Goals for every `?hole`, with tools to fill them: constructors, case
  splits, lemmas, operators ⇄ calls.
- What the compiler writes: JavaScript, a JS module, C, BendTT.
- Windows (`App.run`) in a canvas, with an on-screen pad on phones.
- An assistant and an agent, with your own AI provider or a local model.
- English, French, Portuguese.

## Build

```sh
git clone https://github.com/bendlang/bend ../bend
git -C ../bend checkout "$(cat BEND_COMMIT)"
npm ci
npm run build      # → dist/index.html, the whole workshop in one file
npm test           # examples, guide snippets, conversions, languages
npm run e2e        # browser tests (python3 and playwright)
```

## Publish

`.github/workflows/pages.yml` builds against the Bend commit in
`BEND_COMMIT`, runs the tests, and publishes the page to GitHub Pages on every
push to `main`. Once, in the repository's Settings → Pages, set the source to
"GitHub Actions". To try a newer Bend, run the workflow by hand with a
`bend_ref`; to adopt it, change `BEND_COMMIT`.

## More

`AGENTS.md` records the design choices, the layout of the sources, and how to
test and upgrade.

Bend, its Base library, its guide and the demos used in the examples are
© HigherOrderCO, under the Apache 2.0 license. This is not an official Bend
product.
