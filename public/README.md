# Knucklebones — Neon Edition (installable web app)

Everything here is static. No build step, no server code, no dependencies.

```
index.html                 the whole game
sw.js                      service worker (offline cache)
manifest.webmanifest       app metadata
icon-180/192/512.png       home-screen icons
icon-maskable-512.png      Android adaptive icon
```

## Why it needs hosting

Installing requires a service worker, and browsers only run those from `https://`
(or `localhost`). Opening `index.html` straight off your phone's storage will still
play the game — it just can't install or work offline. So it needs to sit at a URL.
Any static host works; two that take about a minute:

**Netlify Drop** — go to `app.netlify.com/drop` and drag this whole folder onto the
page. You get an `https://something.netlify.app` URL immediately. Claim it with a
free account if you want to keep it.

**GitHub Pages** — create a repo, upload these files to the root, then Settings →
Pages → deploy from `main` / root. Live at `https://<user>.github.io/<repo>/` within
a minute or two.

Either way, open the URL and confirm the game loads before installing.

## Installing it

**iPhone** — open the URL in **Safari** (not Chrome, and not an in-app browser),
tap the share icon, then **Add to Home Screen**. It launches fullscreen with no
browser chrome, its own icon, and works with no signal.

**Android** — open in Chrome. Either accept the install banner, or use menu →
**Install app** / **Add to Home screen**.

**Desktop** — Chrome or Edge show an install icon in the address bar.

## What persists

Win/loss record, best single-game score, and your mode and difficulty preferences
are kept in the browser's local storage. So is the **game in progress** — close the
app mid-match and the title screen offers *Resume*. The rolled die is saved with it,
so quitting after a bad roll hands you the same die back rather than a free reroll.

All of it is local to that device; nothing is uploaded. Clearing site data resets it.

## Other things worth knowing

Rotating to landscape switches to a side-by-side layout where each column becomes a
horizontal row, so opposing columns still face each other.

The gear button in the header opens settings: sound, dice faces (pips or numerals),
the rules, and a record reset. The game also honours your system's reduce-motion
setting, dropping the particles, screen shake and ambient animation — score numbers
still appear, as a plain fade.

## Updating it later

Edit `index.html`, then bump `VERSION` in `sw.js` (e.g. `kb-v1` → `kb-v2`) and
re-upload. Without that bump the old cached copy keeps being served. Installed
copies pick the new version up on their next launch.

## Playing

Roll happens automatically; tap one of **your** columns to drop the die.
Matching dice in a column multiply (`value × count²`), and placing a die destroys
every matching die in the opponent's facing column. When either grid fills, the
higher total wins. `2 PLAYERS` on the title screen is pass-and-play on one phone.
Keyboard: `1` `2` `3` place, `Enter` starts or replays.
