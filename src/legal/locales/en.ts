import type { LegalContentBlock, LegalLocaleContent } from '../types.ts';

const p = (text: string): LegalContentBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalContentBlock => ({ kind: 'list', items });

export const EN_LEGAL: LegalLocaleContent = {
  siteTitle: 'Knucklebones Neon legal information',
  languageLabel: 'Language',
  pageNavigationLabel: 'Legal information',
  languageNavigationLabel: 'Available languages',
  homeLabel: 'Back to the game',
  backLabel: 'Back',
  pendingFact: 'Pending verification before publication',
  pages: {
    imprint: {
      title: 'Provider information',
      shortTitle: 'Imprint',
      description: 'Provider and contact information for Knucklebones Neon.',
      intro: 'Information about the person responsible for this private, non-commercial game project.',
      sections: [
        {
          heading: 'Provider under § 18(1) MStV',
          blocks: [p('{{controllerName}}\n{{controllerStreet}}\n{{controllerPostalCity}}\n{{controllerCountry}}')],
        },
        {
          heading: 'Contact',
          blocks: [p('Email: {{publicEmail}}')],
        },
        {
          heading: 'Project status',
          blocks: [p('This is a free, private hobby project operated by a natural person. There is no company, commercial register entry, VAT identification number, regulated profession, advertising, or paid offer to publish here.')],
        },
      ],
    },
    privacy: {
      title: 'Privacy notice',
      shortTitle: 'Privacy',
      description: 'How Knucklebones Neon processes device, account, and ranked-match data.',
      intro: 'This notice describes the data used by offline play, the hosted PWA, and optional ranked play.',
      sections: [
        {
          heading: 'Controller and contact',
          blocks: [p('{{controllerName}}, {{controllerStreet}}, {{controllerPostalCity}}, {{controllerCountry}}. Email: {{publicEmail}}.')],
        },
        {
          heading: 'Data on your device',
          blocks: [p('Preferences, local statistics, session and cached profile state remain in browser or WebView local storage. The hosted PWA also uses Cache Storage for offline app assets and a temporary session value for failed-chunk recovery. We use no advertising or marketing cookies.')],
        },
        {
          heading: 'Ranked account and match data',
          blocks: [p('Starting ranked play creates a Supabase anonymous account. We then process an account identifier, generated or claimed nickname, avatar code, settings, current and peak points or rating, ladder statistics, profile creation time, and match and move history. If you choose email recovery, Supabase Auth also stores that email address and {{smtpProvider}} delivers the related messages.')],
        },
        {
          heading: 'Purposes and legal bases',
          blocks: [
            p('We process account, matchmaking, match, settings, and ladder data to provide the requested game service and preserve its results (Article 6(1)(b) GDPR).'),
            p('We process limited operational and security data to prevent abuse, enforce rate limits, diagnose failures, and protect the service and other players (Article 6(1)(f) GDPR).'),
          ],
        },
        {
          heading: 'Recipients, regions, and transfers',
          blocks: [
            p('Supabase provides authentication, database, Edge Function, and Realtime services. The database region is {{supabaseDatabaseRegion}} and the Edge Function region is {{supabaseFunctionsRegion}}.'),
            p('Cloudflare Pages delivers the hosted PWA. Its relevant processing scope is: {{cloudflareProcessingScope}}.'),
            p('On iOS, optional Sign in with Apple and Game Center send Apple account or team-player identifiers and signed verification material through Apple services. Game Center verification passes through a rate-limited Cloudflare Worker before Supabase; the app does not receive Game Center profile details beyond the stable team-player identifier needed to restore or protect the ranked account.'),
            p('The safeguards used for relevant international transfers are: {{transferSafeguards}}. The native app loads its bundled web assets instead of downloading them from Cloudflare.'),
            p('We integrate no advertising or behavioral-analytics SDK and no remotely hosted marketing or analytics script. Infrastructure providers may still create operational, security, and access logs.'),
          ],
        },
        {
          heading: 'What other players can see',
          blocks: [p('Nickname, avatar, current and peak points or rating, rank or apex, wins, losses, games, best streak, member-since time, and ranked results can appear to opponents or people using the in-game ladder and player cards. Detailed history is limited to its owner; match participants can read their shared match and move log.')],
        },
        {
          heading: 'Retention and deletion',
          blocks: [p('Guest and recovered accounts remain until deletion. Account deletion removes the hosted profile, settings, ladder rows, queue rows, and match and move history after any active match is settled. If Sign in with Apple is linked, its stored revocation credential is used to remove Apple access; transient failures are retried, and the app gives manual removal instructions if automatic revocation cannot complete. Local preferences and statistics stay on the device until you clear the app or site data. Security logs are retained for {{securityLogRetention}} and backups for {{backupRetention}}.')],
        },
        {
          heading: 'Your rights',
          blocks: [
            p('You may request access, correction, erasure, restriction, portability, or object to processing by writing to {{publicEmail}}. You may also complain to a supervisory authority.'),
            p('Competent authority: {{authorityName}}, {{authorityStreet}}, {{authorityPostalCity}}, {{authorityCountry}}.'),
          ],
        },
        {
          heading: 'Children and age information',
          blocks: [p('The game currently has no age gate and does not ask for or store a birth date. This statement records current product behavior; it is not a claim that every country’s child-privacy requirements are automatically satisfied.')],
        },
      ],
    },
    support: {
      title: 'Support and contact',
      shortTitle: 'Support',
      description: 'How to request game, privacy, or account support for Knucklebones Neon.',
      intro: 'Use the contact below for technical help, privacy requests, or account questions.',
      sections: [
        { heading: 'Contact', blocks: [p('Email: {{publicEmail}}')] },
        {
          heading: 'What we can help with',
          blocks: [list('Technical problems and accessibility issues', 'Ranked account or nickname questions', 'Privacy-rights and account-deletion requests', 'Reports of abuse or security concerns')],
        },
        {
          heading: 'What to include',
          blocks: [p('Describe what happened, which web or app version you used, and—only when needed—the nickname or confirmed email attached to the account. Screenshots are useful when they do not reveal another person’s private information.')],
        },
        {
          heading: 'Keep credentials private',
          blocks: [p('Never send a password, sign-in link, access token, recovery token, or another person’s private data. We will not ask for those credentials by email.')],
        },
        {
          heading: 'Handling requests',
          blocks: [p('We use the minimum information necessary to investigate the request. Privacy and deletion requests require a proportionate ownership check: {{deletionVerification}}.')],
        },
      ],
    },
    'delete-account': {
      title: 'Delete your account',
      shortTitle: 'Delete account',
      description: 'In-app and external instructions for deleting a Knucklebones Neon ranked account.',
      intro: 'Deleting the ranked account is permanent. Local offline data is cleared separately.',
      sections: [
        {
          heading: 'Delete inside the app',
          blocks: [list('Open Profile from Home.', 'Open the account controls.', 'Choose Delete account and review the warning.', 'Confirm the permanent deletion.')],
        },
        {
          heading: 'Hosted data removed',
          blocks: [p('After an active match is settled, deletion removes the Supabase user and cascades the profile, settings, ladder and queue rows, and match and move history. You cannot restore that ranked identity, rating, or history afterward.')],
        },
        {
          heading: 'Local data remains',
          blocks: [p('Deletion signs you out and clears the local account session and cached profile. It does not clear local preferences, offline statistics, or cached app assets on this device. Clear the app’s storage in device settings, or clear this site’s stored data in the browser, to remove those remaining items.')],
        },
        {
          heading: 'Request deletion outside the app',
          blocks: [p('Write to {{publicEmail}} from the confirmed account email when possible. State that you want the Knucklebones Neon ranked account deleted and include the nickname only if needed to locate it.')],
        },
        {
          heading: 'Verification, logs, and backups',
          blocks: [p('Before acting on an external request, we verify ownership as follows: {{deletionVerification}}. Provider security logs may remain for {{securityLogRetention}} and backup copies for {{backupRetention}} before routine expiry.')],
        },
      ],
    },
  },
};
