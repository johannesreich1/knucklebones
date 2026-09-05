# Legal and privacy release checklist

*Current as of 2026-09-05. This is an engineering/completeness checklist, not
individual legal advice. Final publication should receive a German legal
review.*

## Release status and language decision

Johannes's legal name, physical address, federal state, private/hobby status,
and v1 business model are recorded. One typed legal document system now covers
provider information, privacy, support, and account deletion in English,
Brazilian Portuguese, Spanish, German, French, Italian, Polish, Turkish,
Indonesian, Japanese, and Korean. Its checked-in
publication status is deliberately **draft**. By owner decision, Settings now
shows Imprint and Privacy and the attach/sign-in modal shows Privacy using the
localized placeholder document. The build still emits no public legal routes
until every required fact and review flag passes the fail-closed gate. These
in-app placeholders are an interim discoverability measure, not a completed or
reviewed legal publication. The September 5 audit rewrites all document
translations around the actual data flows, gives each required subject a stable
section ID, and keeps publication blocked while the remaining operating facts
are being resolved. A complete translation is not evidence that the underlying
processing or worldwide release has received legal clearance.

Neither store requires a
separate translation merely because the app is downloadable in a country, but
GDPR information must be concise, intelligible, easily accessible, and written
in clear language for the people addressed. V1 therefore prepares one
factually identical notice in all **eleven supported product languages**. A
translation into every store-territory language is not planned. Every later
actively supported or marketed language adds a matching legal translation
before that localization launches. Apple metadata can point each localization
to the corresponding policy URL.

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
- Public support and privacy contact selected by Johannes:
  **support@knucklebones.gg**. This address is intentionally public and must
  remain monitored. The IONOS dashboard confirms the mailbox exists; delivery
  still needs verification.
- Federal state: **Bayern**. The competent private-sector data-protection
  authority is the **Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)**,
  Promenade 18, 91522 Ansbach.
- The app is a private hobby project offered under Johannes's natural-person
  name. There is no Gewerbe, company, register entry, VAT ID, or regulated
  profession to publish.
- V1 is entirely free, with no paid download, in-app purchases, subscriptions,
  donations, advertising, or other monetisation.
- Planned distribution is worldwide. Supported languages are English,
  Brazilian Portuguese, Spanish, German, French, Italian, Polish, Turkish,
  Indonesian, Japanese, and Korean.
- The game contains no adult-only material. Store content ratings must come
  from truthful answers about the actual dice game and must not be raised merely
  to simplify privacy/account compliance.
- **Owner decision reconfirmed 2026-09-05: general audience, all ages.** Keep
  guest, email, Apple and Game Center functions in the intended release. Do not
  introduce a blanket 16/18 minimum or market the app specifically as a children's
  product to resolve this copy task. The app currently has no age gate,
  does not ask for or store a birth date, and does not prevent any age from
  entering ranked play. This records current product behaviour; it is not a
  conclusion that worldwide child/privacy requirements are complete.

## Read-only production evidence, 2026-09-05

The existing Supabase CLI/Management API authentication works even when no
Supabase MCP tools are exposed. `tools/debug/README.md` owns the existing
credential transport; never print its token or Auth configuration secrets.
The following are live observations, not assumptions from a development config:

- Supabase project `euzjcejbkxvqfrttgaxu` is active in `eu-central-1` (Frankfurt),
  on the Pro plan. The organization entitlements report seven days for project
  log access and backup retention. Backup metadata confirms Frankfurt backups
  and disabled PITR. The read returned eight daily backup entries spanning the
  configured recovery window: do not convert that into a guarantee that every
  copy is irreversibly erased after exactly 168 hours. The public backup text
  therefore describes the configured recovery window and normal rotation.
  Project log access does not establish retention of provider-internal records.
- Auth configuration has `audit_log_disable_postgres=true`. A boolean-only
  `EXISTS` check through the read-only query endpoint returned false for
  `auth.audit_log_entries`: there are currently no historical rows, and new
  database audit writes are disabled. Do not keep a hypothetical database-audit
  retention issue on the open list. This does not disable the separate external
  Auth logs covered by project log access.
- Custom SMTP fields are empty and the send-email hook is disabled. Email,
  anonymous and Apple authentication are enabled; email confirmation remains
  required. No test messages were sent. Resend and `mail.ecommercewerke.de` are
  historical proposals only. Johannes subsequently confirmed purchasing
  `knucklebones.gg` through IONOS with Mail Basic 5; this supersedes the earlier
  `knucklebonesneon.com` selection and Cloudflare registration plan. The launch
  `smtpProvider` fact now names IONOS SE (Mail Basic 5). Johannes selected
  `support@knucklebones.gg` as the public contact address. He separately
  confirmed creating `noreply@knucklebones.gg` at IONOS for account messages.
  A subsequent IONOS dashboard check confirmed both mailboxes exist, with zero
  configured forwarding and no optional email archive or AI feature in use.
  Active DNS, Supabase SMTP configuration and successful delivery remain
  unverified; the two mailbox roles are distinct.
- The hourly match-command and Rune Trial command purges are active and have
  recent successful cron runs. `apple-revocation-retry` has the active observed
  cron expression `*/5 * * * *` and recent successful cron runs. A successful scheduler invocation
  is not proof that the outbound HTTP request or Apple revocation succeeded;
  retain the signed-device/end-to-end acceptance requirement.
- Cloudflare's existing Wrangler OAuth can read project/Worker settings. Pages
  project `knucklebones` has only `knucklebones-asg.pages.dev`, no Pages Functions,
  and no configured Web Analytics tag/token in either project or canonical
  deployment. The identity gateway exists; its IP-based rate limiter is
  configured for ten requests per minute. Dedicated Worker settings return
  `observability=null`, `logpush=false` and no Tail consumers, with no regional
  placement configured. No persistent Workers Logs period should be invented.
  Cloudflare's own operating/security metadata remains a separate processing
  category. The account-subscription endpoint returned 403; `standard` usage
  model is not evidence of a Free or Paid tariff.
- Supabase function invocations do not pin a region. The database's Frankfurt
  location does not keep all function execution or provider access in Germany.

No account data, backup contents or credentials were printed, and no provider
settings were changed in these reads. Operational observations belong here;
player-facing facts that have been confirmed are held in `src/legal/config.ts`.

Supabase's current [standard DPA](https://supabase.com/legal/customer-resources/data-processing-addendum) is incorporated into its service agreement and
treats acceptance as execution of its SCCs. Cloudflare's Self-Serve Agreement
§ 6.1 likewise incorporates its [DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) ([Self-Serve terms](https://www.cloudflare.com/terms/)). A separate manual signature is therefore
not a generic missing setup step for those standard terms. The remaining
transfer assessment must cover their actual processing and subcontractors,
plus the selected mail services. Supabase's customer-data DPA confirms internal
audit/traffic records without promising the same short retention as customer
project logs; its general website privacy notice explicitly excludes customer
data and cannot fill that gap. Cloudflare distinguishes customer data it
processes on instructions from certain network data for which it determines
purposes itself; its privacy notice supplies purpose, sensitivity, abuse-risk
and legal-obligation criteria for that separate retention
([Cloudflare privacy](https://www.cloudflare.com/privacypolicy/),
[Supabase privacy scope](https://supabase.com/privacy)).

For the subsequently purchased IONOS Mail Basic 5 service, current public
contract facts are available independently of SMTP activation:

- IONOS's [AVV help](https://www.ionos.de/hilfe/datenschutz/allgemeine-informationen-zur-datenschutz-grundverordnung-dsgvo/vereinbarung-zur-auftragsverarbeitung-avv-mit-ionos-abschliessen/)
  confirms that the AVV is part of the terms for new contracts since July 2022.
- [AVV Annex 1, version 3.0, March 2026, section 2](https://www.ionos.de/terms-gtc/fileadmin/pdf/terms-gtc/DE/AVV/Anhang_1_Leistungsbeschreibungen_AVV_IONOS_v.3.0.pdf)
  specifies a maximum of 28 days from creation for email logs and deletion of
  email-service data within seven days of the customer's deletion action or
  contract end. The translated `smtpRetention` fact derives its durations from
  named constants in `src/legal/mail-retention.ts`. This is not automatic mail
  deletion seven days after sending, and it does not set our support-message
  retention. Do not substitute older mail or unrelated webhosting log periods.
- [AVV Annex 2, version 4.5, April 2026](https://www.ionos.de/terms-gtc/fileadmin/pdf/terms-gtc/DE/AVV/AVV_Liste_Subunternehmen_v4_5_DE.pdf)
  lists 1&1 Mail & Media GmbH (Montabaur) for Mail Basic/Business mail services
  and Open-Xchange GmbH (Olpe) for the webmailer, both in Germany/EU. The
  [AVV § 4.3](https://www.ionos.de/terms-gtc/avv/) provides EU/EEA processing
  with qualified exceptions for necessary international transfers; this is
  not a guarantee that every recipient's mail stays in Germany.
- The subsequent dashboard check confirmed no forwarding or optional email
  archive is configured. Any later activation needs a corresponding recipient
  or retention update. Mailbox existence is not proof of working SMTP delivery.

For the current facts, use a Google Play **personal** developer account. On
Apple's published DSA factors, a free, non-commercial hobby app with no business
status is likely a **non-trader** app; Johannes must make and periodically
reassess that declaration himself. Monetisation, commercial promotion, or a
business connection reopens the assessment.

## Remaining facts and owner actions

Do not guess or publish missing values:

1. Record a reachable phone number privately in both store accounts. Google
   requires a verified contact phone for personal developer accounts, and
   Apple App Review requires a contact phone. Under the current personal,
   non-trader, free model the number does **not** need to be printed in the
   in-app Impressum or public Google developer profile. If Johannes literally
   has no reachable number, store submission remains blocked until he arranges
   one; do not invent or publish a number.
2. Confirm the Apple DSA non-trader declaration in App Store Connect and the
   personal account type in Play Console. Neither repository documentation nor
   the absence of a Gewerbe makes those dashboard declarations automatically.
3. **Complete the review for the owner's all-ages decision:** before the first
   App Store or Play production submission, complete the child-readable notices,
   parental-consent/age-assurance analysis, deletion handling, SDK/provider
   review, applicable country requirements, and truthful store target-audience
   declarations. Do not reintroduce a blanket age cutoff contrary to that
   decision. The hosted PWA is already publicly
   reachable, so do not market it as child-directed or claim child-compliance
   clearance while this review is open.
4. Use the production evidence above for database region/plan and configured
   execution behavior. Finish verification of the applicable DPA and
   subprocessors, log and backup retention, and Cloudflare
   transfer/logging/DPA settings. **Production SMTP is a go-live blocker:**
   configure the purchased IONOS Mail Basic 5 service and
   verify attach-email, confirmation, and recovery delivery end to end before
   the account rollout or Legal release can be marked ready.
5. The current canonical public origin is
   `https://knucklebones-asg.pages.dev`; the purchase of `knucklebones.gg` through
   IONOS is owner-confirmed, with active DNS and the site connection still
   unverified. Choose and document the
   identity-verification workflow for privacy/support/account-deletion requests
   received outside the app; the prepared procedure below still needs an
   end-to-end operational exercise.
   The support inbox is confirmed to have no configured forwarding. Confirm the
   owner's actual deletion practice for completed support messages.
   The proposed 30/90-day support options have not been answered; neither is an
   established retention fact. SMTP retention and inbound support-mail
   retention have separate typed facts.
6. Configure store availability for the intended broad release while excluding
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
- Starting ranked play restores an existing or linked Game Center identity where
  possible, otherwise silently creates a Supabase anonymous account, and stores
  an account ID, generated or claimed nickname, avatar code, settings, rating,
  ladder data, and match/move history.
- Public ladder/player-card endpoints expose nickname, avatar, current and peak
  points/rating, rank/apex, wins, losses, games, best streak, and profile
  creation/member-since time. Detailed match history is owner-only; match
  participants receive the opponent's player card and can read their shared
  match/move log.
- Email/password signup, attachment, sign-in and recovery process the supplied
  email and password credentials in Supabase Auth. Sign in with Apple can also
  supply a real or relay email; email recovery is not the only source of email.
- Game Center authentication initializes at native iOS launch, before ranked
  entry. Restoring/creating the ranked identity is a separate backend step.
- Local profile copies include email/provider-link status, recent matches,
  runes and progress. They are copies of server data, not data that exists
  exclusively on the device. Ranked persistence also includes unlocks,
  achievements, weekly challenge completions and progression events.
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
- Device-data removal differs by platform: browser site-data removal, Android
  app storage/data removal, or deleting the iOS app. iOS offloading retains
  documents/data; all translations distinguish it from deleting the app
  ([Apple's storage instructions](https://support.apple.com/de-de/108429)).
- There is currently no automated 30-day anonymous-account cleanup. Do not
  claim one until an actual scheduled retention job is deployed and verified.
- Technical command receipts become eligible for hourly cleanup only when their
  corresponding match has ended and both match completion and receipt creation
  are older than the configured retention window. This is not an expiry measured
  from receipt creation alone. The legal retention constants are pinned to the
  match-command, Rune Trial and Apple-credential migrations by `tests/legal.test.ts`.
  Apple's worker schedule polls for pending work; each credential
  has its own retry backoff, so it is not a promise to retry every five minutes.
- The repository's iOS identity path sends Apple ID tokens, authorization
  codes, and Game Center team-player assertions through Apple services. Game
  Center assertions cross a rate-limited Cloudflare Worker before Supabase.
  Apple refresh tokens are encrypted in Supabase Vault solely for deletion-time
  revocation; transient failures retry for a bounded period and terminal or
  missing credentials trigger manual-removal instructions. Production rollout
  and final processor/region/retention facts remain owner verification items.

The final GDPR notice must also state the controller/contact, processing
purposes and legal bases, legitimate interests where relied upon, recipient
categories, any relevant international transfers/safeguards, retention rules,
data-subject rights, the right to complain, and the competent authority. The
store privacy/Data Safety answers must be derived from the same inventory.

### Legal-basis and children's review still required

The revised prepublication text proposes Article 6(1)(f) for necessary free-game
and requested account functions, instead of assuming a valid Article 6(1)(b)
contract for every age. Before publication, document the legitimate interest,
necessity and balancing for each purpose: core play/security, optional identity
and recovery, and public ranking/profile visibility. Give particular weight to
children, reasonable expectations, access before public participation and the
absence of an automatic inactive-account expiry. The new wording does not
itself complete that assessment. Statutory rights requests use Article 6(1)(c)
with Articles 12–22; device access needs its separate TDDDG assessment.

Low store content ratings and online accounts for minors can coexist. The
comparison apps below are evidence of that distinction, not compliance
templates. Art. 8 GDPR is not a general minimum age for all data processing.
General-audience positioning alone does not exempt the service from child
protections, and a sentence about contacting parents cannot implement a legally
required authorization flow. Assess the actual applicable markets and the
fully non-commercial facts, including whether COPPA applies, before declaring
worldwide readiness. Where a required authorization flow is missing, implement
and verify that flow before clearing `childPrivacyReviewed`.

### Prepared procedure for account and privacy requests

This procedure supplies the translated `deletionVerification` notice. It is a
prepared operating commitment, not a claim that an external request has already
been fulfilled. Keep `deletionWorkflowVerified` false until the complete path
has been exercised, including email-only and Apple/guest cases.

1. Record the request date, requested right and the minimum contact/account
   details needed to handle the case in the support mailbox, never this
   repository. Track the one-month response deadline. A permitted extension
   needs its reason communicated within that first month.
2. Prefer authenticated deletion through the account controls. For an external
   request, do not identify a person or authorize deletion from nickname, points,
   a screenshot or a claimed sender address alone. If verification is needed,
   request confirmation using the address already verified for that account;
   do not send private account data to an unverified address. A response must
   establish control, not merely match the supplied sender name.
3. Where email proof is unavailable, use the existing sign-in/recovery route or
   authenticated session in the app. Never ask someone to mail a password,
   session token, Apple credential or recovery link. For a parent/guardian,
   establish authority proportionately to the particular request. Do not
   routinely collect identity-document copies. If the account or authority
   cannot be established, explain the limitation and available recovery routes;
   do not delete a guessed account.
4. Account removal must use the reviewed account-deletion operation, which
   settles active opponents and stages Apple revocation before deleting Auth.
   A direct dashboard Auth deletion or SQL DELETE skips those safeguards. The
   signed-in app already calls this operation. An operator-assisted execution
   for an externally verified request still needs a reviewed, exercised path;
   a written email instruction is not that path.
5. Confirm the result only after checking the operation's outcome. Explain
   remaining backup rotation, device-local data and any manual Apple action
   where applicable. Remove extra verification material as soon as it is no
   longer needed. Retain only the minimal case record required for the applicable
   statutory obligations or a concrete legal claim; ordinary support-message
   retention remains the separate, unanswered owner decision above.

## Definite corrections and deliverables

- Do not restore the old EU ODR-platform link. Regulation (EU) 2024/3228
  discontinued the platform and repealed its regulation from 20 July 2025.
- § 36 VSBG addresses entrepreneurs. Under the confirmed private,
  non-commercial hobby model, omit a generic consumer-dispute declaration.
  Reassess if the business model changes or any obligation/commitment to
  participate in dispute resolution arises; do not restore obsolete ODR text.
- Publish accessible, non-geofenced HTML in all eleven supported languages for
  every one of these resources when the publication gate becomes ready:
  - Impressum/provider details;
  - privacy policy;
  - support/contact information;
  - external account-deletion instructions/request path.
- Keep the same privacy and deletion links reachable inside the PWA and native
  apps, then enter them in App Store Connect and Play Console.
- When the publication gate is ready, keep Impressum and Privacy reachable at
  the bottom of Settings and show Privacy contextually in the shared
  attach/sign-in modal. Opening it must preserve the selected auth step and all
  entered values. Ranked entry itself stays silent; there is no blocking legal
  notice in the guest flow.
- Complete App Store Privacy and Google Play Data Safety from the verified
  inventory, including Supabase, Cloudflare, Apple/store services when enabled,
  retention, and deletion.

### Public-page delivery contract

`src/legal/` is the only legal-content source for both the in-app renderer and
generated static pages. Facts that must not be guessed live in
`src/legal/config.ts`; `draft` produces no public routes and exposes only the
owner-approved in-app placeholder doors in Settings/auth, while `ready` first
requires a public email, processor regions and retention facts, localized
transfer/deletion facts, and completed legal, translation, processor,
child-privacy, and deletion-workflow reviews. It also revalidates the complete
localized content registry at publication time: every locale chrome label,
page title, description, introduction, section, heading, paragraph, and list
item must be present and nonblank, so a ready build cannot emit an empty or
partially translated legal page.

The intended route matrix is:

```text
/legal/{en,pt,es,de,fr,it,pl,tr,id,ja,ko}/imprint/
/legal/{en,pt,es,de,fr,it,pl,tr,id,ja,ko}/privacy/
/legal/{en,pt,es,de,fr,it,pl,tr,id,ja,ko}/support/
/legal/{en,pt,es,de,fr,it,pl,tr,id,ja,ko}/delete-account/
```

The generator creates exactly 44 JavaScript-free, semantic HTML pages with a
self-canonical link, eleven locale alternates plus English `x-default`, page and
language navigation, and the correct BCP-47 `lang` (`pt-BR` while the URL uses
stable ID `pt`). It runs before the PWA file snapshot and content hash, so ready
pages participate in versioning and precaching.

When publication is ready, the same documents open in the application as
shared paged overlays. Opening makes the rest of the application inert and
focuses the document heading; the visible Back control and Escape use one close
path that restores the opener's focus. The page body is the only scroller,
long links wrap, and Back plus related-page buttons retain an effective 44 px
hit area. Public page and language navigation use the same target minimum.
Draft keeps public URLs and the Home entry point absent. Settings/auth expose
the explicitly approved placeholder doors; focused tests also use a synthetic
opener to exercise all four shared document types without widening production
navigation.

The service worker recognizes only `/`, `/index.html`, and the generated route
list as cacheable navigations. Root and each legal route retain separate cache
keys. Unknown navigations use the network response without an app-shell
fallback, and a failed asset request never receives HTML. Public support and
deletion pages remain blocked on the monitored public email/request channel.

`tests/legal.test.ts` exercises draft suppression, the ready gate, the complete
registry-derived locale/page matrix, shared renderer parity, metadata, and
unresolved-fact rejection. Each page must contain the required subjects in
`src/legal/sections.ts` exactly once, and each translation must preserve its
English section's fact tokens and paragraph/list structure. Missing rights
sections, rights paragraphs with no tokens, list items and review flags have
each been observed failing against the prior incomplete gate. Placeholder
markers are rejected in ready content and facts in every locale. The in-app
draft document also starts with the localized pending-publication marker,
separated from the introduction: missing this visible status failed the
regression for every draft document before the fix. Region and
retention explanations are whole localized facts, so filling one English
phrase cannot inject it into all translations.
`tests/service-worker.test.mjs` proves root/legal cache isolation and
the absence of arbitrary navigation or asset fallback. The focused legal
browser matrix measures both the in-app controller with its checked-in draft
facts and the generated static pages from a complete non-shipping ready fixture:
every locale/page at all four supported mobile viewports, for both renderers.
It also covers an active-overlay language repaint and a deliberately long URL.
Its first run found the French deletion header wrapping at 320 px, so the
compact header label is intentionally `Suppression` while the document keeps
its full title.

September 5 verification of the revised text and completeness guards:
`mise exec -- npm test -- --suite legal --suite typecheck-tests --suite legal-browser --suite service-worker-routing --suite docs-router`
passed all five suites. The browser owner covered the full registry-derived
locale/page matrix at four mobile viewports for both renderers; German privacy
and device-deletion instructions also received a visual check at 320 px.
An initial sandboxed browser run could not bind localhost; the same focused
gate passed with permission to run its local server. Those preparation checks
did not include the full release gate or native release. The remaining facts
and operating reviews still block final legal publication. No production
provider settings were changed or public legal routes published by this audit.
After the confirmed IONOS purchase, the provider and translated mail-retention
facts were added and `legal.test.ts`, `typecheck-tests.test.ts` and
`docs-router.test.ts` passed again through `mise exec -- node --experimental-strip-types`.
The browser matrix was not repeated for that subsequent content-only addition;
the local review documents were regenerated from the current facts.

Johannes subsequently authorized an immediate engineering release of these
changes using the focused legal suites, explicitly without the full gate. For
this one release, use the existing `releaseMain({ runner })` seam to substitute
only its `npm test` invocation with the focused command above. Keep native
verification, clean-worktree checks, unchanged-HEAD checks and the
fast-forward-only push intact; do not change the helper's default behavior.
The shipped document remains visibly marked as a draft and generates no public
legal routes until the separate publication facts and reviews are complete.

### Release sequence

1. *(Done 2026-09-01: `20260901074059_expand_player_settings_locales_11.sql`
   is applied in production.)* Apply and validate the eleven-ID
   `player_settings.locale` expansion in production before deploying a client
   that can persist `pt`, `es`, or `it`.
2. *(Done: the eleven-language client is live.)* Deploy the eleven-language
   client while `LEGAL_RELEASE.status` remains `draft`; this release has
   neither public legal routes nor production legal links.
3. Complete the public contact channel, provider/processor/retention/transfer
   facts, deletion workflow, territory review, all translations, and German
   legal review. Change the status to `ready` only in a separately reviewed
   change that passes the ready fixture, static-page, browser, service-worker,
   and full release gates.
4. After deployment, derive every canonical URL from the locale/page registries,
   verify each without JavaScript, and then
   enter the localized privacy/support URLs in App Store Connect and the public
   privacy/deletion URLs in Play Console. Dashboard entry is not evidence that
   the repository publication gate passed.

## Primary references

The September 5 comparison used the German app notices for
[NINA](https://www.bbk.bund.de/DE/Warnung-Vorsorge/Warn-App-NINA/NINA-Rechtliches/nina-rechtliches.html)
and [WarnWetter](https://www.warnwetterapp.de/datenschutz.html) as examples of
function-specific, understandable disclosure. Their public-authority legal
bases are not applicable to this private game. The owner's
[Knucklebones comparison](https://apps.apple.com/de/app/knucklebones/id6463731542)
is rated 4+ and links to
[different processing involving advertising/analytics](https://zimmergames.jimdosite.com/privacypolicy/);
its text is not a suitable factual template for this app.
[Lichess](https://apps.apple.com/de/app/lichess/id1662361230) also has a low
content rating, with separate
[account-age/parent rules](https://lichess.org/terms-of-service) and
[Kid Mode](https://lichess.org/page/kid-mode). Store acceptance of another
provider's notice is not evidence of our compliance.

- [§ 5 DDG provider information](https://www.gesetze-im-internet.de/ddg/__5.html)
- [Current official Bavaria § 18 MStV](https://www.gesetze-bayern.de/Content/Document/MStV-18)
- [§ 25 TDDDG device storage/access](https://www.gesetze-im-internet.de/ttdsg/__25.html)
- [DSK information duties, short paper 10](https://www.datenschutzkonferenz-online.de/media/kp/dsk_kpnr_10.pdf)
- [DSK Digital Services guidance, November 2024](https://www.datenschutzkonferenz-online.de/media/oh/OH_Digitale_Dienste.pdf)
- [BayLDA language guidance](https://www.lda.bayern.de/media/FAQ_Informationspflichten_Sprache.pdf)
- [ICO children's lawful-basis guidance (UK, not German case clearance)](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/annex-c-lawful-basis-for-processing/)
- [FTC COPPA FAQ and scope](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
- [Supabase regional function execution](https://supabase.com/docs/guides/functions/regional-invocation)
- [Supabase production SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
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
