import type { LegalContentBlock, LegalLocaleContent } from '../types.ts';

const p = (text: string): LegalContentBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalContentBlock => ({ kind: 'list', items });

export const PL_LEGAL: LegalLocaleContent = {
  siteTitle: 'Informacje prawne Knucklebones Neon',
  languageLabel: 'Język',
  pageNavigationLabel: 'Informacje prawne',
  languageNavigationLabel: 'Dostępne języki',
  homeLabel: 'Powrót do gry',
  backLabel: 'Wstecz',
  pendingFact: 'Oczekuje na weryfikację przed publikacją',
  pages: {
    imprint: {
      title: 'Informacje o usługodawcy',
      shortTitle: 'Nota prawna',
      description: 'Dane usługodawcy i dane kontaktowe Knucklebones Neon.',
      intro: 'Informacje o osobie odpowiedzialnej za ten prywatny, niekomercyjny projekt gry.',
      sections: [
        { heading: 'Usługodawca zgodnie z § 18 ust. 1 MStV', blocks: [p('{{controllerName}}\n{{controllerStreet}}\n{{controllerPostalCity}}\n{{controllerCountry}}')] },
        { heading: 'Kontakt', blocks: [p('E-mail: {{publicEmail}}')] },
        { heading: 'Status projektu', blocks: [p('Jest to bezpłatny, prywatny projekt hobbystyczny prowadzony przez osobę fizyczną. Nie istnieje firma, wpis do rejestru handlowego, numer identyfikacyjny VAT, zawód regulowany, reklama ani płatna oferta, które należałoby tutaj opublikować.')] },
      ],
    },
    privacy: {
      title: 'Informacja o prywatności',
      shortTitle: 'Prywatność',
      description: 'Sposób, w jaki Knucklebones Neon przetwarza dane urządzenia, konta i meczów rankingowych.',
      intro: 'Niniejsza informacja opisuje dane używane podczas gry offline, w hostowanej aplikacji PWA i w opcjonalnej grze rankingowej.',
      sections: [
        { heading: 'Administrator i kontakt', blocks: [p('{{controllerName}}, {{controllerStreet}}, {{controllerPostalCity}}, {{controllerCountry}}. E-mail: {{publicEmail}}.')] },
        { heading: 'Dane na twoim urządzeniu', blocks: [p('Preferencje, lokalne statystyki, sesja oraz zapisany w pamięci podręcznej stan profilu pozostają w pamięci lokalnej przeglądarki lub WebView. Hostowana aplikacja PWA używa też Cache Storage do przechowywania zasobów aplikacji dostępnych offline oraz tymczasowej wartości sesji do odzyskiwania po błędzie wczytania fragmentu aplikacji. Nie używamy plików cookie do celów reklamowych ani marketingowych.')] },
        { heading: 'Konto rankingowe i dane meczów', blocks: [p('Rozpoczęcie gry rankingowej tworzy anonimowe konto Supabase. Następnie przetwarzamy identyfikator konta, wygenerowaną lub wybraną nazwę gracza, kod awatara, ustawienia, bieżące i najwyższe punkty lub ocenę, statystyki rankingu, czas utworzenia profilu oraz historię meczów i ruchów. Jeśli wybierzesz odzyskiwanie przez e-mail, Supabase Auth przechowuje również ten adres, a {{smtpProvider}} dostarcza powiązane wiadomości.')] },
        { heading: 'Cele i podstawy prawne', blocks: [p('Przetwarzamy dane konta, dobierania graczy, meczów, ustawień i rankingu, aby świadczyć zamówioną usługę gry i zachowywać jej wyniki (art. 6 ust. 1 lit. b RODO).'), p('Przetwarzamy ograniczone dane operacyjne i dotyczące bezpieczeństwa, aby zapobiegać nadużyciom, egzekwować limity częstotliwości, diagnozować awarie oraz chronić usługę i innych graczy (art. 6 ust. 1 lit. f RODO).')] },
        { heading: 'Odbiorcy, regiony i przekazywanie danych', blocks: [p('Supabase zapewnia uwierzytelnianie, bazę danych, Edge Functions i Realtime. Region bazy danych to {{supabaseDatabaseRegion}}, a region Edge Functions to {{supabaseFunctionsRegion}}.'), p('Cloudflare Pages dostarcza hostowaną aplikację PWA. Odpowiedni zakres przetwarzania: {{cloudflareProcessingScope}}.'), p('W systemie iOS opcjonalne funkcje logowania przez Apple i Game Center przesyłają za pośrednictwem usług Apple identyfikatory konta Apple lub gracza zespołowego oraz podpisane materiały weryfikacyjne. Weryfikacja Game Center przechodzi przez objęty limitem częstotliwości Cloudflare Worker przed dotarciem do Supabase; aplikacja nie otrzymuje danych profilu Game Center poza stałym identyfikatorem gracza zespołowego potrzebnym do odzyskania lub zabezpieczenia konta rankingowego.'), p('Zabezpieczenia stosowane przy odpowiednim międzynarodowym przekazywaniu danych: {{transferSafeguards}}. Aplikacja natywna wczytuje dołączone do niej zasoby internetowe, zamiast pobierać je z Cloudflare.'), p('Nie integrujemy zestawów SDK do reklam ani analityki behawioralnej, ani zdalnie hostowanych skryptów marketingowych lub analitycznych. Dostawcy infrastruktury mogą jednak tworzyć dzienniki operacyjne, bezpieczeństwa i dostępu.')] },
        { heading: 'Co mogą zobaczyć inni gracze', blocks: [p('Nazwa gracza, awatar, bieżące i najwyższe punkty lub ocena, miejsce w rankingu lub szczyt, wygrane, przegrane, gry, najlepsza seria, czas dołączenia oraz wyniki rankingowe mogą być widoczne dla rywali lub osób korzystających z rankingu i kart graczy w grze. Szczegółowa historia jest dostępna tylko dla właściciela; uczestnicy meczu mogą odczytać wspólny dziennik meczu i ruchów.')] },
        { heading: 'Okres przechowywania i usuwanie', blocks: [p('Konta gości i konta z możliwością odzyskania pozostają do czasu ich usunięcia. Usunięcie konta usuwa hostowany profil, ustawienia, wiersze rankingu i kolejki oraz historię meczów i ruchów po rozstrzygnięciu aktywnego meczu. Jeśli połączono logowanie przez Apple, zapisane poświadczenie unieważnienia służy do usunięcia dostępu Apple; przejściowe błędy są ponawiane, a jeśli automatyczne unieważnienie nie jest możliwe, aplikacja podaje instrukcje ręcznego usunięcia. Lokalne preferencje i statystyki pozostają na urządzeniu do czasu wyczyszczenia danych aplikacji lub witryny. Dzienniki bezpieczeństwa są przechowywane przez {{securityLogRetention}}, a kopie zapasowe przez {{backupRetention}}.')] },
        { heading: 'Twoje prawa', blocks: [p('Możesz zażądać dostępu, sprostowania, usunięcia, ograniczenia przetwarzania lub przeniesienia danych albo wnieść sprzeciw wobec przetwarzania, pisząc na adres {{publicEmail}}. Możesz również złożyć skargę do organu nadzorczego.'), p('Właściwy organ: {{authorityName}}, {{authorityStreet}}, {{authorityPostalCity}}, {{authorityCountry}}.')] },
        { heading: 'Dzieci i informacje o wieku', blocks: [p('Gra nie ma obecnie ograniczenia wiekowego i nie prosi o datę urodzenia ani jej nie przechowuje. To zdanie opisuje bieżące działanie produktu; nie stanowi zapewnienia, że wymogi każdego kraju dotyczące prywatności dzieci są automatycznie spełnione.')] },
      ],
    },
    support: {
      title: 'Pomoc i kontakt',
      shortTitle: 'Pomoc',
      description: 'Jak uzyskać pomoc dotyczącą gry, prywatności lub konta Knucklebones Neon.',
      intro: 'Skorzystaj z poniższych danych kontaktowych, aby uzyskać pomoc techniczną, złożyć wniosek dotyczący prywatności lub zadać pytanie o konto.',
      sections: [
        { heading: 'Kontakt', blocks: [p('E-mail: {{publicEmail}}')] },
        { heading: 'W czym możemy pomóc', blocks: [list('Problemy techniczne i problemy z dostępnością', 'Pytania dotyczące konta rankingowego lub nazwy gracza', 'Wnioski dotyczące praw do prywatności i usunięcia konta', 'Zgłoszenia nadużyć lub zagrożeń bezpieczeństwa')] },
        { heading: 'Co należy podać', blocks: [p('Opisz zdarzenie i podaj używaną wersję internetową lub wersję aplikacji, a tylko w razie potrzeby także nazwę gracza lub potwierdzony adres e-mail powiązany z kontem. Zrzuty ekranu są pomocne, jeśli nie ujawniają prywatnych informacji innej osoby.')] },
        { heading: 'Chroń dane logowania', blocks: [p('Nigdy nie wysyłaj hasła, linku do logowania, tokenu dostępu, tokenu odzyskiwania ani prywatnych danych innej osoby. Nie poprosimy o takie dane logowania w wiadomości e-mail.')] },
        { heading: 'Obsługa wniosków', blocks: [p('Używamy wyłącznie informacji niezbędnych do zbadania wniosku. Wnioski dotyczące prywatności i usunięcia wymagają proporcjonalnego sprawdzenia własności konta: {{deletionVerification}}.')] },
      ],
    },
    'delete-account': {
      title: 'Usuń swoje konto',
      shortTitle: 'Usuń konto',
      description: 'Instrukcje usuwania konta rankingowego Knucklebones Neon w aplikacji i poza nią.',
      intro: 'Usunięcie konta rankingowego jest nieodwracalne. Lokalne dane offline usuwa się oddzielnie.',
      sections: [
        { heading: 'Usuwanie w aplikacji', blocks: [list('Na ekranie startowym otwórz Profil.', 'Otwórz opcje konta.', 'Wybierz Usuń konto i przeczytaj ostrzeżenie.', 'Potwierdź trwałe usunięcie.')] },
        { heading: 'Usuwane dane hostowane', blocks: [p('Po rozstrzygnięciu aktywnego meczu usunięcie kasuje użytkownika Supabase, a wraz z nim profil, ustawienia, wiersze rankingu i kolejki oraz historię meczów i ruchów. Tej tożsamości rankingowej, oceny ani historii nie można później odzyskać.')] },
        { heading: 'Dane lokalne pozostają', blocks: [p('Usunięcie wylogowuje cię oraz kasuje lokalną sesję konta i profil z pamięci podręcznej. Nie usuwa lokalnych preferencji, statystyk offline ani zasobów aplikacji zapisanych w pamięci podręcznej tego urządzenia. Aby usunąć pozostałe elementy, wyczyść pamięć aplikacji w ustawieniach urządzenia lub dane tej witryny zapisane w przeglądarce.')] },
        { heading: 'Wniosek o usunięcie poza aplikacją', blocks: [p('Napisz na adres {{publicEmail}}, w miarę możliwości z potwierdzonego adresu e-mail konta. Poproś o usunięcie konta rankingowego Knucklebones Neon i podaj nazwę gracza tylko wtedy, gdy jest potrzebna do jego odnalezienia.')] },
        { heading: 'Weryfikacja, dzienniki i kopie zapasowe', blocks: [p('Przed realizacją zewnętrznego wniosku sprawdzamy własność konta w następujący sposób: {{deletionVerification}}. Dzienniki bezpieczeństwa dostawcy mogą pozostać przez {{securityLogRetention}}, a kopie zapasowe przez {{backupRetention}}, do czasu ich rutynowego wygaśnięcia.')] },
      ],
    },
  },
};
