# Legal and privacy release checklist

*Current as of 2026-08-24. This is an engineering/completeness checklist, not
individual legal advice. Final publication should receive a German legal
review.*

## Release status and language decision

Johannes's legal name, physical address, federal state, private/hobby status,
and v1 business model are now recorded. The current in-app Impressum/Privacy
copy is still **not releasable** until a dedicated public email address replaces
the remaining explicit placeholder. The hosted app, App Store listing, and Play
listing also need stable public HTML URLs for the privacy notice; Google Play
additionally requires an external account-deletion resource for every app that
lets users create accounts.

The repository runtime is currently English-only; German, English, and French
are the planned first product/store languages. Neither store requires a
separate translation merely because the app is downloadable in a country, but
GDPR information must be concise, intelligible, easily accessible, and written
in clear language for the people addressed. V1 therefore publishes one
factually identical notice in **German, English, and French** if all three
product/store localizations ship. A translation into every store-territory
language is not planned. Every later actively supported or marketed language
adds a matching legal translation before that localization launches. Apple
metadata can point each localization to the corresponding policy URL.

Worldwide availability is the requested distribution scope, not proof that one
privacy notice satisfies every country's consumer, game-registration, child,
or platform rule. Review store availability country by country before launch;
do not enable a territory with a separate unresolved licensing or local-
representative requirement merely to claim global coverage. At minimum, the
first App Store release excludes mainland China and Vietnam: Apple requires an
NPPA game approval plus ICP information for mainland China and a game licence
for Vietnam. Add them only after those approvals actually exist.

## Confirmed owner and release facts

- Provider and GDPR controller: **Johannes Reich**, Krumpterstr. 4,
  81543 München, Germany.
- Federal state: **Bayern**. The competent private-sector data-protection
  authority is the **Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)**,
  Promenade 18, 91522 Ansbach.
- The app is a private hobby project offered under Johannes's natural-person
  name. There is no Gewerbe, company, register entry, VAT ID, or regulated
  profession to publish.
- V1 is entirely free, with no paid download, in-app purchases, subscriptions,
  donations, advertising, or other monetisation.
- Planned distribution is worldwide. Planned first languages are German,
  English, and French, with further European languages later.
- The game contains no adult-only material. Store content ratings must come
  from truthful answers about the actual dice game and must not be raised merely
  to simplify privacy/account compliance.
- **Interim development policy: all ages.** The app currently has no age gate,
  does not ask for or store a birth date, and does not prevent any age from
  entering ranked play. This records current product behaviour; it is not a
  conclusion that worldwide child/privacy requirements are complete.

For the current facts, use a Google Play **personal** developer account. On
Apple's published DSA factors, a free, non-commercial hobby app with no business
status is likely a **non-trader** app; Johannes must make and periodically
reassess that declaration himself. Monetisation, commercial promotion, or a
business connection reopens the assessment.

## Remaining facts and owner actions

Do not guess or publish missing values:

1. Create a dedicated public support/privacy email address and replace every
   `[PUBLIC EMAIL REQUIRED BEFORE RELEASE]` marker. A free mailbox is acceptable;
   a custom-domain mailbox is preferable but not legally necessary. It must be
   monitored, and it will be public in the app, privacy policy, support page,
   and Google Play developer profile.
2. Record a reachable phone number privately in both store accounts. Google
   requires a verified contact phone for personal developer accounts, and
   Apple App Review requires a contact phone. Under the current personal,
   non-trader, free model the number does **not** need to be printed in the
   in-app Impressum or public Google developer profile. If Johannes literally
   has no reachable number, store submission remains blocked until he arranges
   one; do not invent or publish a number.
3. Confirm the Apple DSA non-trader declaration in App Store Connect and the
   personal account type in Play Console. Neither repository documentation nor
   the absence of a Gewerbe makes those dashboard declarations automatically.
4. **Mandatory pre-release reconsideration:** before the first App Store or
   Play production submission, decide whether all-ages online/ranked play will
   remain. If it remains, complete the child-readable notices,
   parental-consent/age-assurance analysis, deletion handling, SDK/provider
   review, country thresholds, and truthful store target-audience declarations.
   Otherwise introduce a clearly scoped online-account age boundary without
   inflating the game's content rating. The hosted PWA is already publicly
   reachable, so do not market it as child-directed or claim child-compliance
   clearance while this review is open.
5. Verify the exact Supabase database/Function regions and plan, DPA and
   subprocessors, log and backup retention; Cloudflare transfer/logging/DPA
   settings; and any production SMTP provider before finalising the processor,
   transfer, and retention paragraphs.
6. Choose the public domain/routes and an identity-verification workflow for
   privacy/support/account-deletion requests received outside the app.
7. Configure store availability for the intended broad release while excluding
   mainland China and Vietnam until their game approvals are obtained. Review
   any other territory-specific store warnings rather than blindly selecting
   “all countries.”

For a natural person with no register entry, VAT ID, regulated profession, or
company representative, those corporate sections are omitted rather than
published as “not applicable.” The present free hobby app records public
provider identification under § 18(1) MStV. § 5 DDG must be reassessed if the
service becomes business-like or commercial. A separate responsibility
statement under § 18(2) MStV is only relevant if journalistic-editorial content
is offered; it is not included for the game by default.

## Facts the final notice must match

- Offline preferences/statistics remain in WebView/browser local storage.
- The hosted PWA also uses Cache Storage for offline application assets and a
  temporary sessionStorage recovery flag; “four localStorage keys” is not a
  complete description of device-side storage.
- Starting ranked play silently creates a Supabase anonymous account and stores
  an account ID, generated or claimed nickname, avatar code, settings, rating,
  ladder data, and match/move history.
- Public ladder/player-card endpoints expose nickname, avatar, current and peak
  points/rating, rank/apex, wins, losses, games, best streak, and profile
  creation/member-since time. Detailed match history is owner-only; match
  participants receive the opponent's player card and can read their shared
  match/move log.
- An attached email address is stored when the player chooses email recovery.
- Supabase processes hosted account/match data. Verify and name the exact
  database and Edge Function regions, subprocessors, transfer safeguards, log
  retention, and backup retention before publishing the final policy.
- Cloudflare Pages delivers the hosted PWA and processes delivery/request data;
  native builds load the same web assets from the bundle rather than Cloudflare.
- No analytics, ads, behavioral tracking, location, contacts, camera, or
  user-uploaded images are currently integrated by the app; bundled service
  SDKs and provider operational/security/access logs still need to be disclosed
  accurately. Phrase this as no developer advertising or behavioral-analytics
  SDK, not an absolute claim that infrastructure creates no analytics or logs.
- Account deletion deletes the Supabase user and cascades the profile, settings,
  match/move history, queue rows, and ladder rows after active-match settlement.
- Local preferences/statistics are not removed by server-side account deletion;
  provider security logs and backups have separate retention windows that must
  be verified and disclosed.
- There is currently no automated 30-day anonymous-account cleanup. Do not
  claim one until an actual scheduled retention job is deployed and verified.
- Apple identity/Game Center are deferred. Before enabling them, add Apple to
  the data/recipient inventory and implement Apple token revocation during
  account deletion.

The final GDPR notice must also state the controller/contact, processing
purposes and legal bases, legitimate interests where relied upon, recipient
categories, any relevant international transfers/safeguards, retention rules,
data-subject rights, the right to complain, and the competent authority. The
store privacy/Data Safety answers must be derived from the same inventory.

## Definite corrections and deliverables

- Do not restore the old EU ODR-platform link. Regulation (EU) 2024/3228
  discontinued the platform and repealed its regulation from 20 July 2025.
- Confirm whether a consumer-dispute statement is needed under the current
  business model and VSBG employee exception; omit it until that is confirmed
  and do not use a generic generator.
- Publish accessible, non-geofenced HTML in German, English, and French for
  every one of these resources when all three localizations ship:
  - Impressum/provider details;
  - privacy policy;
  - support/contact information;
  - external account-deletion instructions/request path.
- Keep the same privacy and deletion links reachable inside the PWA and native
  apps, then enter them in App Store Connect and Play Console.
- Complete App Store Privacy and Google Play Data Safety from the verified
  inventory, including Supabase, Cloudflare, Apple/store services when enabled,
  retention, and deletion.

### Public-page delivery contract

Use the shared application locale registry and one legal-content source for the
in-app copy and generated static pages. The intended route matrix is:

```text
/legal/{de,en,fr}/imprint/
/legal/{de,en,fr}/privacy/
/legal/{de,en,fr}/support/
/legal/{de,en,fr}/delete-account/
```

The current Cloudflare Pages fallback serves the game Home page for unknown
deep paths, so none of those URLs exists merely because the root PWA exists.
Generate real static HTML with canonical and `hreflang` links; do not maintain a
second prose copy in `public/`. Before adding the routes, fix the service worker
so only `/` and `/index.html` can replace the cached app shell and each legal
page caches under its own URL. Otherwise visiting a privacy page can poison the
offline Home cache. The public support and deletion pages remain blocked on the
monitored public email/request channel.

## Primary references

- [§ 5 DDG provider information](https://www.gesetze-im-internet.de/ddg/__5.html)
- [§ 18 MStV provider information](https://www.die-medienanstalten.de/fileadmin/user_upload/Rechtsgrundlagen/Gesetze_Staatsvertraege/Medienstaatsvertrag_MStV.pdf)
- [GDPR Articles 12 and 13](https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04/eng)
- [§ 36 VSBG](https://www.gesetze-im-internet.de/vsbg/__36.html)
- [EU ODR discontinuation, Regulation (EU) 2024/3228](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R3228)
- [Apple App Privacy requirements](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
- [Apple support URL and review-contact requirements](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
- [Apple DSA trader self-assessment](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements)
- [Apple age-rating override](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/)
- [Google Play Developer Program privacy/account-deletion policy](https://support.google.com/googleplay/android-developer/answer/17190352)
- [Google Play developer contact requirements](https://support.google.com/googleplay/android-developer/answer/10840893)
- [Google Play target-audience settings](https://support.google.com/googleplay/android-developer/answer/9867159)
- [BayLDA contact and complaints](https://www.lda.bayern.de/de/kontakt.html)
- [Apple country-specific game requirements](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
