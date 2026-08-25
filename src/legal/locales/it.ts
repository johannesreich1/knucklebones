import type { LegalContentBlock, LegalLocaleContent } from '../types.ts';

const p = (text: string): LegalContentBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalContentBlock => ({ kind: 'list', items });

export const IT_LEGAL: LegalLocaleContent = {
  siteTitle: 'Informazioni legali di Knucklebones Neon',
  languageLabel: 'Lingua',
  pageNavigationLabel: 'Informazioni legali',
  languageNavigationLabel: 'Lingue disponibili',
  homeLabel: 'Torna al gioco',
  backLabel: 'Indietro',
  pendingFact: 'In attesa di verifica prima della pubblicazione',
  pages: {
    imprint: {
      title: 'Informazioni sul responsabile',
      shortTitle: 'Note legali',
      description: 'Informazioni sul responsabile e contatti di Knucklebones Neon.',
      intro: 'Dati della persona responsabile di questo progetto di gioco privato e non commerciale.',
      sections: [
        { heading: 'Responsabile ai sensi del § 18(1) MStV', blocks: [p('{{controllerName}}\n{{controllerStreet}}\n{{controllerPostalCity}}\n{{controllerCountry}}')] },
        { heading: 'Contatto', blocks: [p('E-mail: {{publicEmail}}')] },
        { heading: 'Stato del progetto', blocks: [p('È un progetto personale gratuito gestito da una persona fisica. Non esistono società, iscrizione al registro imprese, partita IVA, professione regolamentata, pubblicità o offerta a pagamento da indicare.')] },
      ],
    },
    privacy: {
      title: 'Informativa sulla privacy',
      shortTitle: 'Privacy',
      description: 'Come Knucklebones Neon tratta i dati del dispositivo, dell’account e delle partite classificate.',
      intro: 'Questa informativa descrive i dati usati nel gioco offline, nella PWA ospitata e nelle partite classificate facoltative.',
      sections: [
        { heading: 'Titolare e contatto', blocks: [p('{{controllerName}}, {{controllerStreet}}, {{controllerPostalCity}}, {{controllerCountry}}. E-mail: {{publicEmail}}.')] },
        { heading: 'Dati sul dispositivo', blocks: [p('Preferenze, statistiche locali, sessione e copia del profilo restano nella memoria locale del browser o della WebView. La PWA ospitata usa anche Cache Storage per i file offline e un valore di sessione temporaneo per recuperare caricamenti falliti. Non usiamo cookie pubblicitari o di marketing.')] },
        { heading: 'Account e partite classificate', blocks: [p('Avviare una partita classificata crea un account Supabase anonimo. Trattiamo un identificativo account, nickname generato o scelto, codice avatar, impostazioni, valore attuale e massimo del punteggio o della valutazione, dati di classifica, data di creazione del profilo e cronologia di partite e mosse. Se scegli il recupero via e-mail, Supabase Auth conserva anche l’indirizzo e {{smtpProvider}} invia i relativi messaggi.')] },
        { heading: 'Finalità e basi giuridiche', blocks: [p('Trattiamo dati di account, abbinamento, partita, impostazioni e classifica per fornire il servizio richiesto e conservarne i risultati (art. 6(1)(b) GDPR).'), p('Trattiamo dati operativi e di sicurezza limitati per prevenire abusi, applicare limiti, diagnosticare problemi e proteggere il servizio e gli altri giocatori (art. 6(1)(f) GDPR).')] },
        { heading: 'Destinatari, regioni e trasferimenti', blocks: [p('Supabase fornisce autenticazione, database, Edge Functions e Realtime. La regione del database è {{supabaseDatabaseRegion}} e quella delle Edge Functions è {{supabaseFunctionsRegion}}.'), p('Cloudflare Pages distribuisce la PWA ospitata. L’ambito di trattamento rilevante è: {{cloudflareProcessingScope}}.'), p('Su iOS, le opzioni Accedi con Apple e Game Center inviano tramite i servizi Apple identificativi dell’account Apple o del giocatore di squadra e materiale di verifica firmato. La verifica Game Center passa da un Worker Cloudflare con limite di frequenza prima di Supabase; l’app non riceve altri dati del profilo Game Center.'), p('Le garanzie applicabili ai trasferimenti internazionali sono: {{transferSafeguards}}. L’app nativa carica invece i file web inclusi nel pacchetto.'), p('Non integriamo SDK pubblicitari o di analisi comportamentale né script remoti di marketing o analisi. I fornitori dell’infrastruttura possono comunque creare log operativi, di sicurezza e di accesso.')] },
        { heading: 'Cosa vedono gli altri giocatori', blocks: [p('Nickname, avatar, valore attuale e massimo del punteggio o della valutazione, posizione o appartenenza all’1% migliore, vittorie, sconfitte, partite, serie migliore, data di iscrizione e risultati delle partite classificate possono apparire agli avversari o nella classifica e nelle schede giocatore. La cronologia dettagliata è riservata al titolare; i partecipanti possono leggere il registro condiviso di partita e mosse.')] },
        { heading: 'Conservazione ed eliminazione', blocks: [p('Gli account ospite o recuperati restano fino all’eliminazione. Dopo la conclusione di un’eventuale partita attiva, l’eliminazione rimuove profilo, impostazioni, classifica, coda e cronologia di partite e mosse. Se Accedi con Apple è collegato, la credenziale di revoca salvata viene usata per rimuovere l’accesso Apple; gli errori temporanei vengono ritentati e, in caso contrario, l’app mostra istruzioni manuali. Preferenze e statistiche locali restano finché non cancelli i dati dell’app o del sito. I log di sicurezza sono conservati {{securityLogRetention}} e i backup {{backupRetention}}.')] },
        { heading: 'I tuoi diritti', blocks: [p('Puoi chiedere accesso, rettifica, cancellazione, limitazione, portabilità o opporti al trattamento scrivendo a {{publicEmail}}. Puoi anche presentare reclamo a un’autorità di controllo.'), p('Autorità competente: {{authorityName}}, {{authorityStreet}}, {{authorityPostalCity}}, {{authorityCountry}}.')] },
        { heading: 'Minori e informazioni sull’età', blocks: [p('Attualmente il gioco non prevede una verifica dell’età e non chiede o conserva la data di nascita. Ciò descrive il funzionamento attuale; non afferma che le norme sulla privacy dei minori di ogni paese siano automaticamente soddisfatte.')] },
      ],
    },
    support: {
      title: 'Assistenza e contatti',
      shortTitle: 'Assistenza',
      description: 'Come chiedere assistenza tecnica, privacy o account per Knucklebones Neon.',
      intro: 'Usa il contatto seguente per assistenza tecnica, richieste privacy o domande sull’account.',
      sections: [
        { heading: 'Contatto', blocks: [p('E-mail: {{publicEmail}}')] },
        { heading: 'Come possiamo aiutare', blocks: [list('Problemi tecnici e di accessibilità', 'Domande sull’account usato nelle partite classificate o sul nickname', 'Diritti privacy ed eliminazione account', 'Segnalazioni di abuso o sicurezza')] },
        { heading: 'Cosa includere', blocks: [p('Descrivi l’accaduto e la versione web o app usata. Indica nickname o e-mail confermata solo se necessario. Gli screenshot aiutano se non mostrano dati privati altrui.')] },
        { heading: 'Proteggi le credenziali', blocks: [p('Non inviare mai password, link di accesso, token di accesso o recupero né dati privati altrui. Non chiederemo queste credenziali via e-mail.')] },
        { heading: 'Gestione delle richieste', blocks: [p('Usiamo solo i dati necessari all’indagine. Le richieste privacy ed eliminazione richiedono una verifica proporzionata della titolarità: {{deletionVerification}}.')] },
      ],
    },
    'delete-account': {
      title: 'Elimina il tuo account',
      shortTitle: 'Elimina account',
      description: 'Istruzioni dentro e fuori dall’app per eliminare un account usato nelle partite classificate di Knucklebones Neon.',
      intro: 'L’eliminazione dell’account usato nelle partite classificate è permanente. I dati offline locali si cancellano separatamente.',
      sections: [
        { heading: 'Elimina nell’app', blocks: [list('Apri Profilo dalla Home.', 'Apri i controlli dell’account.', 'Scegli Elimina account e leggi l’avviso.', 'Conferma l’eliminazione permanente.')] },
        { heading: 'Dati eliminati dal server', blocks: [p('Dopo la conclusione di un’eventuale partita attiva, l’eliminazione rimuove l’utente Supabase e, a cascata, profilo, impostazioni, classifica, coda e cronologia di partite e mosse. L’identità usata nelle partite classificate, la valutazione e la cronologia non possono essere ripristinate.')] },
        { heading: 'I dati locali restano', blocks: [p('L’eliminazione disconnette l’account e cancella la sessione locale dell’account e la copia del profilo in cache. Non cancella le preferenze locali, le statistiche offline né i file dell’app in cache su questo dispositivo. Cancella i dati dell’app nelle impostazioni del dispositivo o i dati salvati del sito nel browser.')] },
        { heading: 'Richiedi fuori dall’app', blocks: [p('Scrivi a {{publicEmail}}, se possibile dall’e-mail confermata dell’account. Chiedi di eliminare l’account usato nelle partite classificate di Knucklebones Neon e indica il nickname solo se serve a trovarlo.')] },
        { heading: 'Verifica, log e backup', blocks: [p('Prima di dare seguito a una richiesta esterna, verifichiamo la titolarità così: {{deletionVerification}}. I log di sicurezza possono restare {{securityLogRetention}} e le copie di backup {{backupRetention}} fino alla normale scadenza.')] },
      ],
    },
  },
};
