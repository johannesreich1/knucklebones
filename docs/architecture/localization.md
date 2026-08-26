# Localization architecture

Read this page before adding player-visible copy, changing locale detection or
the language setting, or adjusting a layout that translated text can affect.
Frontend ownership and CSS rules remain in `frontend.md` and `styles.md`.

## Locale model

`src/i18n/` owns locale vocabulary, catalogs, lookup, formatting, and DOM
translation. The supported application locales are registered once, in picker
order, as `en`, `pt`, `es`, `de`, `fr`, and `it`. Those stable IDs own catalogs,
routes, and persisted settings. Each registry entry also owns the BCP-47 tag
used by HTML, `Intl`, and native metadata. Brazilian Portuguese therefore has
the stable ID `pt` and presentation tag `pt-BR`; the other tags currently match
their IDs. Region subtags do not select separate catalogs: for example,
`pt-BR` and `pt-PT` both resolve to `pt`, `es-MX` resolves to `es`, and `it-CH`
resolves to `it`. Unsupported or malformed values resolve to English.

The effective locale has this precedence:

1. an explicit supported locale ID user override;
2. the first supported language in the current platform language list;
3. English.

Web, PWA, and Capacitor WebView builds read the ordered browser language list,
which reflects the device languages on iOS and Android. A future native
adapter must feed the same ordered-tag resolver rather than add a second locale
policy. Locale resolution is synchronous at startup; all catalogs needed to
start the app are bundled, so translation does not add a network or
loading-screen dependency.

The iOS shell declares `en`, `pt-BR`, `es`, `de`, `fr`, and `it` in
`CFBundleLocalizations` because
the WebView catalogs are localizations handled manually by the app rather than
`.lproj` resources. Keep that declaration and the native shell contract in
sync with the registry. Android WebView language detection uses the same
browser resolver and does not require a native locale plugin.

`null` represents the absence of an explicit language choice and is never
shown as a selectable language. The Settings arrows display only the effective
language's self-name and cycle the registry order, wrapping at both ends. The
first arrow press while following the system starts from the
displayed effective locale and stores the adjacent language as an explicit
override. After that, the user setting wins on every platform and participates
in account Settings sync like the other user preferences.

## Runtime API and ownership

The implementation uses i18next for proven catalog lookup, interpolation,
plural selection, and fallback behavior, without adding a UI-framework
binding. A small repository-owned TypeScript facade supplies the strict key
types, platform detection, DOM-root ownership, and synchronous repaint
contract the game needs. Feature modules import that facade, never i18next
directly. This keeps the library replaceable and prevents two competing locale
state sources.

Callers use the public `src/i18n/index.ts` API rather than importing a catalog
or platform adapter directly:

- `SUPPORTED_LOCALES`, `LOCALE_REGISTRY`, `localeSelfName`, and
  `localeLanguageTag` drive language choices, self-names, and presentation tags.
- `languageOverride`, `effectiveLocale`, `setLanguageOverride`, and
  `refreshSystemLocale` own locale state and changes.
- `t` returns typed plain text. `text` is the element helper. Interpolated
  values stay text, never HTML.
- `translateDom` handles repository-authored `data-i18n`, `data-i18n-attr`,
  and `data-i18n-rich` hooks. Rich entries are limited to trusted static
  catalog markup and cannot interpolate input.
- `bindLocaleRoot` translates once, subscribes to later changes, and sets the
  BCP-47 `lang` plus stable `data-locale` on the owned root. The
  standalone/PWA/native app may set those attributes on
  `document.documentElement`; the widget sets them on `#kbroot` only and must
  not alter its host page.
- `formatNumber`, `formatDate`, and `formatRelativeTime` are the locale-aware
  formatting boundary. Game rules and persisted numeric values stay neutral.

The localization layer may depend on browser/platform adapters and UI code may
depend on localization. `src/core/` must remain locale-free: authoritative
rules, replay, scoring, IDs, and network payloads use stable machine values.
Translate only at the player-visible boundary. Controllers also keep stable
IDs and request labels from a catalog or registry instead of branching on a
language.

Static markup needs an explicit translation hook because the runtime does not
watch arbitrary DOM mutations. Code that creates or substantially changes a
dynamic subtree translates or fills it at that ownership boundary. A locale
change notifies subscribed shared renderers so currently visible copy repaints
without a reload. Build-generated player-visible markup follows the same rule:
the widget's screen-reader heading carries a catalog hook, is translated inside
`#kbroot`, and never inherits an English-only label from its host fragment.

Legal prose is intentionally separate from the ordinary short-copy catalogs:
`src/legal/` owns structured sections and fact slots for every registered
locale, and the in-app and JavaScript-free static renderers consume the same
document object. Adding a supported locale therefore also requires its complete
legal document before publication can become ready. URL segments use the stable
locale ID (`pt`) while HTML `lang` and `hreflang` use the registry tag
(`pt-BR`). See `docs/LEGAL.md` for the fail-closed release gate.

## Catalog rules

English is the complete source catalog, the catalog schema, and the per-key
fallback. Every locale must have exactly the same keys and interpolation
placeholder names as English; catalog tests reject missing, extra, blank, or
placeholder-divergent entries. At runtime, a missing entry must resolve to the
English value rather than a key name or blank string. Use placeholders for
values inside a sentence and give translators the whole sentence. Do not
concatenate translated fragments or encode grammar in CSS.

Use concise, natural copy rather than literal word-for-word translations. Keep
language names self-named in the selector. Accessible names, live-region copy,
button labels, headings, errors, and empty states are player-visible copy too
and belong in the catalogs. Update the document/root language whenever the
effective locale changes so assistive technology uses the right pronunciation.

Adding a locale means adding one registry entry and complete catalog, extending
the locale type through that registry, adding a database migration that extends
the `player_settings.locale` check allow-list, and covering detection, fallback,
cycling, persistence, account sync, root ownership, and the full layout matrix.
Feature code must not gain a new locale-specific conditional. Deploy that
database migration before the client: old clients omit and preserve the new
column, while the new client cannot safely select it until the schema exists.

### Terminology glossary

Keep these choices consistent in gameplay, help, online surfaces, and
accessibility copy. `Knucklebones`, player nicknames, and player-entered values
are never translated.

| Concept | English | Portuguese (Brazil) | Spanish | German | French | Italian |
|---|---|---|---|---|---|---|
| computer player | AI | IA | IA | KI | IA | IA |
| ranked match | ranked match | partida ranqueada | partida clasificatoria | Ranglistenspiel | partie classée | partita classificata |
| ladder | ladder | ranking | clasificación | Rangliste | classement | classifica |
| rune | rune | runa | runa | Rune | rune | runa |
| game mode | game mode | modo de jogo | modo de juego | Spielmodus | mode de jeu | modalità di gioco |
| draw (result) | draw | empate | empate | Unentschieden | égalité | pareggio |
| ladder points | ladder points | pontos de ranking | puntos de clasificación | Ranglistenpunkte | points de classement | punti classifica |

Mode, rune, and ladder-group IDs are machine vocabulary. Their localized
names and compact labels live in catalogs; portable core code must never use a
display label as an identifier.

## Game-view length budgets

The shared game view is the tightest translation surface and local and ranked
play must continue to use the same labels. Translation review is a layout task,
not only a catalog review. Prefer a shorter equivalent when a translation is
materially longer. Where a registry label has a genuinely different compact
use, give the registry an explicit compact slot; do not silently clip text,
shrink one language below the readable type scale, or create a parallel view.
When a live status needs shorter visible copy, its typed status pair keeps the
complete localized sentence as the element's accessible name and removes that
name when ordinary visible copy replaces it.

The report-only length audit counts visible Unicode grapheme clusters after
removing catalog markup and interpolation placeholders. It flags a translation
only when it is both more than 30% longer than English and at least four
graphemes longer. Every flag is a prompt to review the owning surface, not a
failure: natural longer copy remains valid when the rendered mobile geometry
passes. Catalog key and placeholder parity remain hard gates, as do the compact
label limits. Run the audit with
`mise exec -- node --experimental-strip-types tests/i18n-length-report.test.ts`.

Verify every supported locale at 320 × 568 and 390 × 844 portrait, 568 × 320
and 667 × 375 landscape, and at widget widths 320, 390, and 520. Measure
computed boxes and hit testing in these pressure points:

The eager/mobile/widget command for this matrix is currently a deliberate
manual check, not part of the default release gate, because its computed
geometry does not replace human review of the rendered result. Run
`mise exec -- node tests/browser/localization/run.mjs` for locale, copy, or
shared-layout changes, then perform the final visual pass below.

- turn/status text and the portrait one-line or landscape two-line status lane;
- mode and rune HUD chips, which must remain readable without unintended wrap;
- player plates, player names, score labels, and compact tags;
- roll/placement prompts, reveal and pass-the-phone copy;
- spell targeting, protection, timer, and error feedback;
- tutorial steps, confirmation cards, result verdict/subtitle, and actions;
- Settings labels, selector value, and accessible names.

Single-word result verdicts keep the normal display scale when they fit. The
shared result renderer reduces only an unbroken verdict that would exceed 90%
of the owned app root, recalculating after locale and viewport changes; do not
replace that neutral fitter with locale selectors or per-language offsets.
Multi-word player-result titles retain their intentional wrapping.

A test passes only when visible text stays inside its reserved box, required
lines are not clipped, interactive targets remain reachable and at least 44 px,
and translated copy does not overlap another visible element. DOM presence or
the absence of horizontal page scroll alone is not sufficient. Exercise state
variants whose later CSS can win: seating/orientation, short viewport, numeral
dice, reduced motion, colour-blind mode, spells, modes, result, and ranked UI.

For each new or changed game-view string, record the intended line/width budget
next to the owning component or its focused browser assertion. Translators can
then choose wording against a concrete constraint instead of guessing from the
English screen.

After reviewing a length warning, make a final visual pass of its constrained
surface in the in-app Browser at 320 × 568 and 568 × 320. If the correction
changes shared styling or a captured product state, regenerate every affected
preview/export rather than leaving evidence from the previous layout.

The geometry contract is stricter than general overflow checks: portrait game
status owns one reserved line; landscape status owns the existing 104 px-wide,
two-line/26 px-high lane. HUD chips, mode/rune labels, player plates, result
banners, handoff/tutorial prompts, rune reveal/deal, and pickers may not move or
resize the board. Locale switching may change gameplay geometry by no more than
0.5 px. Use catalog-owned compact/short variants when a constrained surface
needs them—never global font shrinking, silent truncation, or an unintended
ellipsis.
