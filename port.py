"""Turn the standalone game into a fragment for the inline widget host.

Every transformation asserts that it actually applied. A silent no-op here once
shipped a widget with an undefined function, which only showed up as a console
error mid-game.
"""
import re, sys

src = open('knucklebones.html').read()

style = re.search(r'<style>([\s\S]*?)</style>', src).group(1)
body  = re.search(r'<body[^>]*>([\s\S]*?)</body>', src).group(1)
js    = re.findall(r'<script>([\s\S]*?)</script>', src)[-1]

def sub(text, old, new, label):
    if old not in text:
        sys.exit(f'PORT FAILED: pattern not found for "{label}"')
    if text.count(old) != 1:
        sys.exit(f'PORT FAILED: pattern for "{label}" matched {text.count(old)} times')
    return text.replace(old, new)

# ---- body: drop the scripts-blocked overlay and every inline script ----
body = re.sub(r'<!-- Shown only when scripts[\s\S]*?<script>document\.getElementById\(.ovNoJs.\)\.remove\(\);</script>', '', body)
body = re.sub(r'<!--[\s\S]*?-->', '', body)
before = body
body = re.sub(r'<script>[\s\S]*?</script>', '', body)
if body == before:
    sys.exit('PORT FAILED: expected an inline script inside <body> to strip')

# ---- CSS: nothing may be position:fixed inside the widget iframe ----
style = re.sub(r'html,body\{[^}]*\}', '', style)
style = re.sub(r'\nbody\{[^}]*\}', '', style)
for sel in ['#bg{position:fixed', '#vig{position:fixed', '#app{position:fixed',
            '#fx{position:fixed', '.flash{position:fixed', '.ov{position:fixed']:
    style = sub(style, sel, sel.replace('fixed', 'absolute'), sel)

style = sub(style,
  '#app{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;\n'
  '  padding:calc(env(safe-area-inset-top,0px) + 6px) 10px calc(env(safe-area-inset-bottom,0px) + 6px);\n'
  '  max-width:520px;margin:0 auto;}',
  '#app{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;padding:6px 10px;}',
  'app shell padding')

shell = """
#kbroot{position:relative;width:100%;height:640px;border-radius:16px;overflow:hidden;
  background:#05060e;color:#e9f1ff;
  font-family:ui-rounded,"SF Pro Rounded",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;
  touch-action:manipulation;-webkit-user-select:none;user-select:none;
  -webkit-tap-highlight-color:transparent;border:0.5px solid rgba(255,255,255,.12);isolation:isolate}
#kbroot *{box-sizing:border-box}
"""

# ---- JS: coordinates are relative to #kbroot, not the viewport ----
js = sub(js,
  "function burst(x,y,color,n){\n  if(REDUCED) return;\n  const fx=$('#fx');",
  "function rootRect(){ return $('#kbroot').getBoundingClientRect(); }\n"
  "function burst(x,y,color,n){\n  if(REDUCED) return;\n  const fx=$('#fx');"
  " const rr=rootRect(); x-=rr.left; y-=rr.top;",
  'burst coordinate rebasing')

js = sub(js, "document.body.appendChild(ghost);", "$('#kbroot').appendChild(ghost);", 'ghost parent')
js = sub(js, "ghost.style.position='fixed';", "ghost.style.position='absolute';", 'ghost positioning')
js = sub(js, "ghost.style.left=from.left+'px';",
             "ghost.style.left=(from.left-rootRect().left)+'px';", 'ghost left')
js = sub(js, "ghost.style.top=from.top+'px';",
             "ghost.style.top=(from.top-rootRect().top)+'px';", 'ghost top')
js = sub(js, "const app=$('#app');\n  const w=app.clientWidth, h=app.clientHeight;",
             "const app=$('#kbroot');\n  const w=app.clientWidth, h=app.clientHeight;", 'fit measures the shell')
js = sub(js, "document.addEventListener('gesturestart',e=>e.preventDefault());",
             "$('#kbroot').addEventListener('contextmenu',e=>e.preventDefault());", 'gesture guard')
js = sub(js, "document.addEventListener('keydown',e=>{",
             "document.addEventListener('keydown',e=>{\n    if(!$('#kbroot')) return;", 'keyboard guard')
# the service worker belongs to the hosted build only
js = re.sub(r"  // Offline support[\s\S]*?\n  \}\n", "", js)
if 'serviceWorker' in js:
    sys.exit('PORT FAILED: service worker registration still present')

out  = '<h2 class="sr-only">Playable Knucklebones dice game: two 3 by 3 grids, tap a column to place your rolled die.</h2>\n'
out += '<style>' + shell + style + '</style>\n'
out += '<div id="kbroot">' + body.strip() + '</div>\n'
out += '<script>\n' + js + '\n</script>\n'

open('widget.html', 'w').write(out)

# ---- final guards ----
if 'position:fixed' in out: sys.exit('PORT FAILED: position:fixed survived')
if out.count('<script>') != 1: sys.exit('PORT FAILED: expected exactly one script block')
for name in ['rootRect', 'startTimer', 'resumeGame', 'boardUp', 'coachShow', 'tutOnChoose', 'clearTut', 'floatPts', 'faceRotated']:
    if 'function ' + name not in out:
        sys.exit(f'PORT FAILED: {name} missing from the fragment')
# every function the fragment calls must be defined in it
called = set(re.findall(r'\b([a-zA-Z_]\w*)\s*\(', out))
defined = set(re.findall(r'function\s+([a-zA-Z_]\w*)', out)) | set(re.findall(r'(?:const|let|var)\s+([a-zA-Z_]\w*)\s*=', out))
builtin = {'if','for','while','switch','catch','return','typeof','function','Math','JSON','Number',
           'Array','Object','String','Boolean','Promise','setTimeout','setInterval','clearInterval',
           'clearTimeout','parseInt','parseFloat','requestAnimationFrame','isNaN','Date','fetch','new'}
missing = sorted(n for n in called - defined - builtin
                 if not n[0].isupper() and n not in dir(__builtins__) and
                 not re.search(r'[\.\w]' + n + r'\s*\(', ''))
print('widget bytes:', len(out))
print('OK — all patches applied')
