// Legal copy is kept apart from the interactive screen shell so it can be
// reviewed and completed without loading the board, settings, and result UI.
export const LEGAL_MARKUP = `<!-- LEGAL. Two PAGES below Home, not sheets: they are reached from Home's foot
     and ‹ returns there, so they wear the ‹ every other Home destination wears
     (design: 00-navigation). They floated over nothing — the sheet clothes were
     the same mistake Settings wore until 2026-08-21, and a bottom "Got it" is a
     navigation button at the bottom of a screen, which this app retired.
     Runtime services and storage statements below follow the current code.
     The remaining bracketed email is a release blocker, not publishable copy. -->
<div class="ov paged" id="ovImprint">
  <div class="shead">
    <button class="ico" id="btnImprintBack" aria-label="Back">‹</button>
    <span class="ttl">IMPRESSUM</span><span class="pad"></span>
  </div>
  <div class="pbody">
  <div class="rules">
    <h3>Angaben gemäß § 18 Abs. 1 MStV</h3>
    <p>Johannes Reich<br>Krumpterstr. 4<br>81543 München<br>Germany</p>
    <h3>Contact</h3>
    <p>Email: [PUBLIC EMAIL REQUIRED BEFORE RELEASE]</p>
  </div>
  </div>
</div>

<div class="ov paged" id="ovPrivacy">
  <div class="shead">
    <button class="ico" id="btnPrivacyBack" aria-label="Back">‹</button>
    <span class="ttl">PRIVACY</span><span class="pad"></span>
  </div>
  <div class="pbody">
  <div class="rules">
    <h3>Who is responsible</h3>
    <p>Johannes Reich, Krumpterstr. 4, 81543 München, Germany.<br>
       Email: [PUBLIC EMAIL REQUIRED BEFORE RELEASE]. See the Impressum for full details.</p>
    <h3>What this game stores</h3>
    <p>Offline gameplay, preferences, and statistics are not sent to Supabase; they remain on
       your device. If you use the hosted web version, Cloudflare still receives the normal
       request metadata needed to deliver the app. The moment you play <b>ranked</b>, an account
       is created — silently, as a guest — and from then on we hold: an account identifier, a
       nickname (generated for you, or the one you claim once yourself), your avatar choice,
       rating and ladder record, game settings, and match and move history. If you attach an
       email address to keep the account, Supabase Auth holds that too.</p>
    <h3>What leaves your device</h3>
    <p>Ranked account, settings, ladder, and match data is sent to <b>Supabase</b>, which stores
       it on our behalf and provides authentication, database, Edge Function, and Realtime
       services. <b>Cloudflare Pages</b> delivers the hosted web version; the installed native
       app loads bundled web assets instead. These providers may process your IP address,
       device/browser information, and request metadata in operational and security logs when
       you use their part of the service. We integrate <b>no advertising or behavioral-
       analytics SDK</b> and run no remotely hosted marketing or analytics script.</p>
    <h3>Device storage</h3>
    <p>The game uses local storage for your session, a cached copy of your own profile, account
       state, preferences, and local statistics. The hosted PWA also uses Cache Storage for
       offline assets and a temporary session value for failed-chunk recovery. It does not use
       advertising or marketing cookies.</p>
    <h3>Why we may do this</h3>
    <p>To provide the game you asked for (Art. 6(1)(b) GDPR) and to keep the service from being
       abused, e.g. rate limits on account creation (Art. 6(1)(f) GDPR).</p>
    <h3>How long</h3>
    <p>Guest and attached accounts are retained until they are deleted. <b>You can delete your
       account at any time</b> — Account → Delete account removes the hosted profile, settings,
       matches and rating. Local preferences and statistics remain on the device until you clear
       the app or site data. Provider security logs and backups follow their separately stated
       retention periods.</p>
    <h3>What other players see</h3>
    <p>Your nickname, avatar, rank, current and peak rating/points, wins, losses, games played,
       best streak, member-since date, and ranked match results may be shown to opponents or
       anyone viewing the in-game ladder and player cards. Your detailed match history is shown
       only to you and the players who took part in those matches.</p>
    <h3>Your rights</h3>
    <p>You may request access, correction, erasure, restriction, portability, and object to
       processing. Write to [PUBLIC EMAIL REQUIRED BEFORE RELEASE]. You may also complain to a
       supervisory authority. The competent authority for this controller is the Bayerisches
       Landesamt für Datenschutzaufsicht (BayLDA), Promenade 18, 91522 Ansbach, Germany.</p>
  </div>
  </div>
</div>`;
