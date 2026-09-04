# Candidate typefaces (design study 58)

Twelve faces the app could adopt as its ONE font, and the files the study cards
render them with. The app ships no font today: `src/styles/page.css` names
OS-provided faces, so the same screen is SF Pro Rounded on Apple, Roboto on
Android and — as `tests/support/rendering-font.mjs` exists to say out loud —
whatever fontconfig ranks first on a Linux CI runner.

## What is in here

    <slug>/OFL.txt      the family's licence, downloaded from google/fonts
    <slug>/<weight>.woff2   a TEXT SUBSET of that weight
    candidates.json     the index design/build.mjs reads for {{font:…}}

> **Chakra Petch shipped.** The app bundles it as of design study 58 —
> `src/styles/fonts/` holds the real files (full latin + latin-ext at 400/500/600/700)
> and `src/styles/foundations/typeface.css` declares them. Its digits come from
> Saira: Chakra Petch has no tabular figures, and the ladder is a column of
> right-aligned scores. The subsets here stay because the comparison board
> (`design/screens/product/58-font-board.html`) still pictures all twelve.

**The woff2 files are preview material, not a shippable bundle.** Each is cut to
the glyphs the study cards paint (the Home screen's strings, the digits, and the
pl/tr/pt/de accents that decide whether a face can carry our locales at all), so
a card can embed its own face as a data URI and render identically offline, on a
Linux runner, and inside the Design pane. Adopting a face means downloading the full latin + latin-ext files for the
weights the app uses and putting them in `src/styles/fonts/`, referenced by
`url()` from a stylesheet — NOT `public/`. Vite has to process them: the
single-file builds inline the bytes (the iOS payload contract asserts
`native/www/assets` does not exist), the widget build sets `publicDir:false` so a
`/fonts/…` URL would resolve against whatever page embeds the widget, and
`design/build.mjs` inlines the graph as text and rewrites `url()` to a data URI
by basename against that directory.

Regenerate with `mise exec -- node design/fonts/fetch-candidates.mjs`; the subsets come
from the Google Fonts CSS API's `text=` parameter and the licences from
`raw.githubusercontent.com/google/fonts/main/ofl/<slug>/OFL.txt`.

## Licensing

All twelve are **SIL Open Font License 1.1** — verified against the OFL text
downloaded beside each family, not against a listing page. That permits bundling
in a commercial app and shipping it through both stores, with no fee and no
attribution in the UI. Two conditions bind us: ship `OFL.txt` with the font
files, and never sell the fonts on their own. A modified font may not keep its
Reserved Font Name, so if we ever subset-and-rename, rename it.

## What none of them cover

CJK. The app is localized to `ja` and `ko`, and a Noto CJK bundle is 4–8 MB, so
the stack names the candidate first and lets the OS supply Japanese and Korean —
exactly what happens today.
