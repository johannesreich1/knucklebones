import type { LegalContentBlock, LegalLocaleContent } from '../types.ts';

const p = (text: string): LegalContentBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalContentBlock => ({ kind: 'list', items });

export const DE_LEGAL: LegalLocaleContent = {
  siteTitle: 'Rechtliche Informationen zu Knucklebones Neon',
  languageLabel: 'Sprache',
  pageNavigationLabel: 'Rechtliche Informationen',
  languageNavigationLabel: 'Verfügbare Sprachen',
  homeLabel: 'Zurück zum Spiel',
  backLabel: 'Zurück',
  pendingFact: 'Vor Veröffentlichung noch zu prüfen',
  pages: {
    imprint: {
      title: 'Anbieterkennzeichnung',
      shortTitle: 'Impressum',
      description: 'Anbieter- und Kontaktangaben für Knucklebones Neon.',
      intro: 'Angaben zur verantwortlichen Person dieses privaten, nicht kommerziellen Spieleprojekts.',
      sections: [
        { heading: 'Anbieter gemäß § 18 Abs. 1 MStV', blocks: [p('{{controllerName}}\n{{controllerStreet}}\n{{controllerPostalCity}}\n{{controllerCountry}}')] },
        { heading: 'Kontakt', blocks: [p('E-Mail: {{publicEmail}}')] },
        { heading: 'Projektstatus', blocks: [p('Dies ist ein kostenloses, privates Hobbyprojekt einer natürlichen Person. Es bestehen kein Unternehmen, kein Handelsregistereintrag, keine Umsatzsteuer-ID, kein reglementierter Beruf, keine Werbung und kein kostenpflichtiges Angebot, die hier anzugeben wären.')] },
      ],
    },
    privacy: {
      title: 'Datenschutzhinweise',
      shortTitle: 'Datenschutz',
      description: 'Wie Knucklebones Neon Geräte-, Konto- und Ranglistenspieldaten verarbeitet.',
      intro: 'Diese Hinweise beschreiben die Datenverarbeitung beim Offline-Spiel, in der gehosteten PWA und beim optionalen Ranglistenspiel.',
      sections: [
        { heading: 'Verantwortlicher und Kontakt', blocks: [p('{{controllerName}}, {{controllerStreet}}, {{controllerPostalCity}}, {{controllerCountry}}. E-Mail: {{publicEmail}}.')] },
        { heading: 'Daten auf deinem Gerät', blocks: [p('Einstellungen, lokale Statistiken, Sitzungsdaten und ein zwischengespeichertes eigenes Profil verbleiben im lokalen Speicher des Browsers oder WebViews. Die gehostete PWA nutzt außerdem Cache Storage für Offline-App-Dateien und vorübergehend einen Sitzungswert zur Wiederherstellung nach fehlerhaft geladenen Programmteilen. Wir verwenden keine Werbe- oder Marketing-Cookies.')] },
        { heading: 'Ranglistenkonto und Spieldaten', blocks: [p('Mit dem Start eines Ranglistenspiels wird ein anonymes Supabase-Konto erstellt. Danach verarbeiten wir eine Konto-ID, einen erzeugten oder selbst gewählten Nickname, Avatar-Code, Einstellungen, aktuelle und höchste Punkte beziehungsweise Wertung, Ranglistenstatistiken, den Erstellungszeitpunkt des Profils sowie Spiel- und Zughistorie. Wenn du die E-Mail-Wiederherstellung wählst, speichert Supabase Auth auch diese Adresse; {{smtpProvider}} versendet die zugehörigen Nachrichten.')] },
        { heading: 'Zwecke und Rechtsgrundlagen', blocks: [p('Konto-, Vermittlungs-, Spiel-, Einstellungs- und Ranglistendaten verarbeiten wir, um den gewünschten Spieldienst bereitzustellen und Ergebnisse zu erhalten (Art. 6 Abs. 1 Buchst. b DSGVO).'), p('Begrenzte Betriebs- und Sicherheitsdaten verarbeiten wir, um Missbrauch zu verhindern, Limits durchzusetzen, Fehler zu untersuchen und den Dienst sowie andere Spielende zu schützen (Art. 6 Abs. 1 Buchst. f DSGVO).')] },
        { heading: 'Empfänger, Regionen und Übermittlungen', blocks: [p('Supabase stellt Authentifizierung, Datenbank, Edge Functions und Realtime bereit. Datenbankregion: {{supabaseDatabaseRegion}}; Edge-Function-Region: {{supabaseFunctionsRegion}}.'), p('Cloudflare Pages liefert die gehostete PWA aus. Der dafür relevante Verarbeitungsumfang lautet: {{cloudflareProcessingScope}}.'), p('Unter iOS senden die optionalen Dienste „Mit Apple anmelden“ und Game Center Apple-Konto- oder Team-Spieler-IDs sowie signierte Prüfdaten über Apple-Dienste. Die Game-Center-Prüfung läuft über einen ratenbegrenzten Cloudflare Worker an Supabase; die App erhält außer der stabilen Team-Spieler-ID keine Game-Center-Profildaten.'), p('Für einschlägige internationale Übermittlungen gelten folgende Garantien: {{transferSafeguards}}. Die native App lädt stattdessen gebündelte Webdateien.'), p('Wir binden weder Werbe- oder verhaltensbezogene Analyse-SDKs noch extern gehostete Marketing- oder Analyseskripte ein. Infrastrukturanbieter können dennoch Betriebs-, Sicherheits- und Zugriffsprotokolle erstellen.')] },
        { heading: 'Was andere sehen', blocks: [p('Nickname, Avatar, aktuelle und höchste Punkte oder Wertung, Rang beziehungsweise Apex, Siege, Niederlagen, Spiele, beste Serie, Beitrittszeitpunkt und Ranglistenergebnisse können Gegnern oder Personen in Rangliste und Spielerkarten angezeigt werden. Die ausführliche Historie sieht nur der Kontoinhaber; Beteiligte können ihr gemeinsames Spiel- und Zugprotokoll lesen.')] },
        { heading: 'Speicherdauer und Löschung', blocks: [p('Gast- und wiederherstellbare Konten bleiben bis zur Löschung bestehen. Nach Abschluss eines aktiven Spiels entfernt die Kontolöschung Profil, Einstellungen, Ranglisten- und Warteschlangeneinträge sowie Spiel- und Zughistorie. Bei verknüpfter Apple-Anmeldung wird der gespeicherte Widerrufsnachweis zum Entfernen des Apple-Zugriffs verwendet; vorübergehende Fehler werden erneut versucht, andernfalls zeigt die App eine manuelle Anleitung. Lokale Einstellungen und Statistiken bleiben bis zum Löschen der App- oder Websitedaten auf dem Gerät. Sicherheitsprotokolle werden {{securityLogRetention}}, Sicherungen {{backupRetention}} aufbewahrt.')] },
        { heading: 'Deine Rechte', blocks: [p('Du kannst unter {{publicEmail}} Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit verlangen oder der Verarbeitung widersprechen. Außerdem kannst du dich bei einer Aufsichtsbehörde beschweren.'), p('Zuständige Behörde: {{authorityName}}, {{authorityStreet}}, {{authorityPostalCity}}, {{authorityCountry}}.')] },
        { heading: 'Kinder und Altersangaben', blocks: [p('Das Spiel hat derzeit keine Altersabfrage und fragt oder speichert kein Geburtsdatum. Dies beschreibt das aktuelle Produktverhalten; es ist keine Behauptung, dass damit automatisch die Kinder-Datenschutzregeln jedes Landes erfüllt sind.')] },
      ],
    },
    support: {
      title: 'Support und Kontakt',
      shortTitle: 'Support',
      description: 'Technische, Datenschutz- oder Kontohilfe für Knucklebones Neon anfordern.',
      intro: 'Nutze den folgenden Kontakt für technische Hilfe, Datenschutzanfragen oder Kontofragen.',
      sections: [
        { heading: 'Kontakt', blocks: [p('E-Mail: {{publicEmail}}')] },
        { heading: 'Wobei wir helfen', blocks: [list('Technische Probleme und Barrieren', 'Fragen zu Ranglistenkonto oder Nickname', 'Datenschutzrechte und Kontolöschung', 'Meldungen zu Missbrauch oder Sicherheitsproblemen')] },
        { heading: 'Notwendige Angaben', blocks: [p('Beschreibe den Vorgang und die verwendete Web- oder App-Version. Nenne nur wenn nötig den Nickname oder die bestätigte Konto-E-Mail. Screenshots helfen, sofern sie keine privaten Daten anderer Personen zeigen.')] },
        { heading: 'Zugangsdaten geheim halten', blocks: [p('Sende niemals Passwort, Anmeldelink, Zugriffs- oder Wiederherstellungstoken oder private Daten anderer. Wir fragen per E-Mail nicht nach solchen Zugangsdaten.')] },
        { heading: 'Bearbeitung von Anfragen', blocks: [p('Wir verwenden nur die zur Prüfung nötigen Angaben. Datenschutz- und Löschanfragen erfordern eine angemessene Inhaberprüfung: {{deletionVerification}}.')] },
      ],
    },
    'delete-account': {
      title: 'Konto löschen',
      shortTitle: 'Konto löschen',
      description: 'Anleitung zur Löschung eines Knucklebones-Neon-Ranglistenkontos in und außerhalb der App.',
      intro: 'Das Ranglistenkonto wird dauerhaft gelöscht. Lokale Offline-Daten löschst du gesondert.',
      sections: [
        { heading: 'In der App löschen', blocks: [list('Öffne auf Home dein Profil.', 'Öffne die Kontoeinstellungen.', 'Wähle Konto löschen und lies den Hinweis.', 'Bestätige die endgültige Löschung.')] },
        { heading: 'Gelöschte Serverdaten', blocks: [p('Nach Abschluss eines aktiven Spiels löscht der Vorgang den Supabase-Nutzer und damit Profil, Einstellungen, Ranglisten- und Warteschlangeneinträge sowie Spiel- und Zughistorie. Ranglistenidentität, Wertung und Historie können danach nicht wiederhergestellt werden.')] },
        { heading: 'Lokale Daten bleiben', blocks: [p('Die Löschung meldet dich ab und entfernt die lokale Kontositzung sowie das zwischengespeicherte Profil. Sie entfernt nicht die lokalen Einstellungen, Offline-Statistiken oder zwischengespeicherten App-Dateien von diesem Gerät. Lösche dafür den App-Speicher in den Geräteeinstellungen oder die gespeicherten Websitedaten im Browser.')] },
        { heading: 'Löschung außerhalb der App', blocks: [p('Schreibe möglichst von der bestätigten Konto-E-Mail an {{publicEmail}}. Bitte um Löschung des Knucklebones-Neon-Ranglistenkontos und nenne den Nickname nur, falls er zum Auffinden nötig ist.')] },
        { heading: 'Prüfung, Protokolle und Sicherungen', blocks: [p('Vor einer extern angeforderten Löschung prüfen wir die Inhaberschaft so: {{deletionVerification}}. Sicherheitsprotokolle können {{securityLogRetention}} und Sicherungskopien {{backupRetention}} bis zum regulären Ablauf verbleiben.')] },
      ],
    },
  },
};
