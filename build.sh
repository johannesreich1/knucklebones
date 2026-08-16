#!/usr/bin/env bash
# Build every deliverable from the single source file.
#
# knucklebones.html is the ONLY file to edit. Everything else here is generated:
# hand-copying them is what let the hosted build and the native build drift apart
# earlier in development.
set -euo pipefail
cd "$(dirname "$0")"

SRC=knucklebones.html
[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }

# --- syntax gate: never propagate a broken source ---
node -e '
const fs=require("fs");
const src=fs.readFileSync("'"$SRC"'","utf8");
const blocks=[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if(!blocks.length){ console.error("no script block found"); process.exit(1); }
blocks.forEach((m,i)=>{ try{ new Function(m[1]); }catch(e){ console.error("syntax error in block "+i+": "+e.message); process.exit(1); } });
console.log("source parses ("+blocks.length+" script blocks)");
'

# --- fan out to the copies ---
mkdir -p pwa native/www
cp "$SRC" knucklebones-neon.html      # standalone single file
cp "$SRC" pwa/index.html              # hosted PWA bundle
cp "$SRC" native/www/index.html       # Capacitor web assets

# --- bump the service worker cache key off the source's own hash ---
# Without a bump, installed copies keep serving the previous build forever.
HASH=$(md5sum "$SRC" | cut -c1-8)
sed -i "s/^const VERSION = '.*';/const VERSION = 'kb-$HASH';/" pwa/sw.js
# stamp the visible build tag in the shipped copies (the source keeps "dev")
sed -i "s/build dev</build $HASH</" pwa/index.html native/www/index.html knucklebones-neon.html
echo "service worker cache key: kb-$HASH"

# --- regenerate the inline widget fragment + its test harness ---
python3 port.py
python3 - <<'PYEOF'
w=open('widget.html').read()
h=('<!DOCTYPE html><html><head><meta charset="utf-8">'
 '<meta name="viewport" content="width=device-width,initial-scale=1">'
 '<style>body{margin:0;padding:12px 8px;background:#faf9f5}'
 '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}</style></head><body>'
 + w + '</body></html>')
open('harness.html','w').write(h)
PYEOF

# --- prove the copies are identical, rather than assuming ---
for f in knucklebones-neon.html pwa/index.html native/www/index.html; do
  if ! diff -q <(sed "s/build $HASH</build dev</" "$f") "$SRC" >/dev/null; then
    echo "COPY MISMATCH: $f"; exit 1
  fi
done
echo "3 copies verified identical to $SRC (modulo build stamp)"

# --- push web assets into the native projects if they exist ---
if [ -d native/node_modules ] && [ -d native/android ]; then
  (cd native && npx cap sync >/dev/null 2>&1) && echo "native projects synced"
fi

echo "build ok"
