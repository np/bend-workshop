#!/bin/sh
# Builds the checker bundle (dist/bend-core.js) from a clone of bendlang/bend
# at ../bend. The page itself is then assembled by build_html.mjs.
set -e
cd "$(dirname "$0")"
[ -d node_modules/.bin ] && PATH="$PWD/node_modules/.bin:$PATH"
node scripts/gen_assets.mjs "$(cd ../bend && git rev-parse --short=7 HEAD)" >/dev/null
esbuild core/entry.ts --bundle --format=iife --global-name=BendCore --platform=browser --target=es2020 $1 \
  --alias:node:fs=./core/shim/fs.ts --alias:node:path=./core/shim/path.ts --alias:node:os=./core/shim/os.ts \
  --alias:node:url=./core/shim/url.ts --alias:node:child_process=./core/shim/child_process.ts \
  --alias:node:crypto=./core/shim/crypto.ts --inject:./core/shim/globals.ts \
  '--define:import.meta.url="file:///bend/bend2/bend.ts"' '--define:import.meta.require=undefined' \
  --log-level=warning --outfile=dist/bend-core.js
ls -la dist/bend-core.js
