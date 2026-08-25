import type { LegalContentBlock, LegalLocaleContent } from '../types.ts';

const p = (text: string): LegalContentBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalContentBlock => ({ kind: 'list', items });

export const FR_LEGAL: LegalLocaleContent = {
  siteTitle: 'Informations légales de Knucklebones Neon',
  languageLabel: 'Langue',
  pageNavigationLabel: 'Informations légales',
  languageNavigationLabel: 'Langues disponibles',
  homeLabel: 'Retour au jeu',
  backLabel: 'Retour',
  pendingFact: 'Vérification requise avant publication',
  pages: {
    imprint: {
      title: 'Informations sur le responsable',
      shortTitle: 'Mentions légales',
      description: 'Informations sur le responsable et coordonnées de Knucklebones Neon.',
      intro: 'Informations sur la personne responsable de ce projet de jeu privé et non commercial.',
      sections: [
        { heading: 'Responsable selon le § 18(1) MStV', blocks: [p('{{controllerName}}\n{{controllerStreet}}\n{{controllerPostalCity}}\n{{controllerCountry}}')] },
        { heading: 'Contact', blocks: [p('E-mail : {{publicEmail}}')] },
        { heading: 'Statut du projet', blocks: [p('Il s’agit d’un projet personnel gratuit géré par une personne physique. Il n’existe aucune société, inscription au registre du commerce, identification TVA, profession réglementée, publicité ou offre payante à indiquer ici.')] },
      ],
    },
    privacy: {
      title: 'Avis de confidentialité',
      shortTitle: 'Confidentialité',
      description: 'Comment Knucklebones Neon traite les données de l’appareil, du compte et des parties classées.',
      intro: 'Cet avis décrit les données utilisées par le jeu hors ligne, la PWA hébergée et le jeu classé facultatif.',
      sections: [
        { heading: 'Responsable et contact', blocks: [p('{{controllerName}}, {{controllerStreet}}, {{controllerPostalCity}}, {{controllerCountry}}. E-mail : {{publicEmail}}.')] },
        { heading: 'Données sur votre appareil', blocks: [p('Les préférences, statistiques locales, données de session et copie du profil restent dans le stockage local du navigateur ou de la WebView. La PWA hébergée utilise aussi Cache Storage pour les fichiers hors ligne et une valeur de session temporaire pour récupérer un chargement défaillant. Nous n’utilisons aucun cookie publicitaire ou marketing.')] },
        { heading: 'Compte et parties classées', blocks: [p('Commencer une partie classée crée un compte Supabase anonyme. Nous traitons alors un identifiant de compte, un pseudo généré ou choisi, un code d’avatar, les réglages, les points ou le classement actuel et maximal, les statistiques du classement, la date de création du profil et l’historique des parties et coups. Si vous choisissez la récupération par e-mail, Supabase Auth conserve aussi cette adresse et {{smtpProvider}} envoie les messages correspondants.')] },
        { heading: 'Finalités et bases juridiques', blocks: [p('Nous traitons les données de compte, recherche d’adversaire, partie, réglages et classement pour fournir le service demandé et conserver ses résultats (article 6(1)(b) du RGPD).'), p('Nous traitons des données opérationnelles et de sécurité limitées pour prévenir les abus, appliquer des limites, diagnostiquer les pannes et protéger le service et les autres joueurs (article 6(1)(f) du RGPD).')] },
        { heading: 'Destinataires, régions et transferts', blocks: [p('Supabase fournit l’authentification, la base de données, les Edge Functions et Realtime. La région de la base est {{supabaseDatabaseRegion}} et celle des Edge Functions est {{supabaseFunctionsRegion}}.'), p('Cloudflare Pages distribue la PWA hébergée. Le périmètre de traitement concerné est : {{cloudflareProcessingScope}}.'), p('Les garanties applicables aux transferts internationaux sont : {{transferSafeguards}}. L’application native charge plutôt les fichiers web inclus dans son paquet.'), p('Nous n’intégrons aucun SDK publicitaire ou d’analyse comportementale ni script distant de marketing ou d’analyse. Les fournisseurs d’infrastructure peuvent néanmoins créer des journaux opérationnels, de sécurité et d’accès.')] },
        { heading: 'Ce que voient les autres joueurs', blocks: [p('Pseudo, avatar, points ou classement actuel et maximal, rang ou sommet, victoires, défaites, parties, meilleure série, date d’inscription et résultats classés peuvent être visibles par les adversaires ou dans le classement et les fiches joueur. L’historique détaillé est réservé au titulaire ; les participants peuvent lire le journal de leur partie et de leurs coups communs.')] },
        { heading: 'Conservation et suppression', blocks: [p('Les comptes invités ou récupérés restent jusqu’à leur suppression. Après règlement d’une partie active, la suppression efface profil, réglages, classement, file et historique des parties et coups. Les préférences et statistiques locales restent jusqu’à l’effacement des données de l’application ou du site. Les journaux de sécurité sont conservés {{securityLogRetention}} et les sauvegardes {{backupRetention}}.')] },
        { heading: 'Vos droits', blocks: [p('Vous pouvez demander accès, rectification, effacement, limitation, portabilité ou vous opposer au traitement en écrivant à {{publicEmail}}. Vous pouvez aussi saisir une autorité de contrôle.'), p('Autorité compétente : {{authorityName}}, {{authorityStreet}}, {{authorityPostalCity}}, {{authorityCountry}}.')] },
        { heading: 'Enfants et âge', blocks: [p('Le jeu n’a actuellement aucun contrôle d’âge et ne demande ni ne conserve de date de naissance. Cela décrit son fonctionnement actuel ; ce n’est pas l’affirmation que les règles de protection des enfants de chaque pays sont automatiquement satisfaites.')] },
      ],
    },
    support: {
      title: 'Assistance et contact',
      shortTitle: 'Assistance',
      description: 'Demander une aide technique, relative à la confidentialité ou au compte pour Knucklebones Neon.',
      intro: 'Utilisez le contact ci-dessous pour une aide technique, une demande de confidentialité ou une question de compte.',
      sections: [
        { heading: 'Contact', blocks: [p('E-mail : {{publicEmail}}')] },
        { heading: 'Notre assistance', blocks: [list('Problèmes techniques et d’accessibilité', 'Questions de compte classé ou de pseudo', 'Droits relatifs aux données et suppression de compte', 'Signalements d’abus ou de sécurité')] },
        { heading: 'Informations utiles', blocks: [p('Décrivez le problème et la version web ou de l’application utilisée. N’indiquez le pseudo ou l’e-mail confirmé que si nécessaire. Une capture aide si elle ne révèle pas les données privées d’un tiers.')] },
        { heading: 'Gardez vos identifiants secrets', blocks: [p('N’envoyez jamais mot de passe, lien de connexion, jeton d’accès ou de récupération ni données privées d’autrui. Nous ne les demanderons pas par e-mail.')] },
        { heading: 'Traitement des demandes', blocks: [p('Nous utilisons le minimum de données nécessaire à l’examen. Les demandes liées aux données ou à la suppression exigent un contrôle proportionné de propriété : {{deletionVerification}}.')] },
      ],
    },
    'delete-account': {
      title: 'Supprimer votre compte',
      shortTitle: 'Suppression',
      description: 'Instructions dans et hors de l’application pour supprimer un compte classé Knucklebones Neon.',
      intro: 'La suppression du compte classé est définitive. Les données hors ligne locales sont effacées séparément.',
      sections: [
        { heading: 'Supprimer dans l’application', blocks: [list('Ouvrez Profil depuis l’accueil.', 'Ouvrez les commandes du compte.', 'Choisissez Supprimer le compte et lisez l’avertissement.', 'Confirmez la suppression définitive.')] },
        { heading: 'Données supprimées du serveur', blocks: [p('Après règlement d’une partie active, la suppression efface l’utilisateur Supabase et, en cascade, profil, réglages, classement, file et historique des parties et coups. Cette identité classée, son classement et son historique ne peuvent pas être restaurés.')] },
        { heading: 'Les données locales restent', blocks: [p('La suppression vous déconnecte et efface la session locale du compte ainsi que la copie du profil en cache. Elle n’efface pas les préférences locales, les statistiques hors ligne ni les fichiers de l’application en cache sur cet appareil. Effacez le stockage de l’application dans les réglages de l’appareil ou les données du site dans le navigateur.')] },
        { heading: 'Demander hors de l’application', blocks: [p('Écrivez à {{publicEmail}}, si possible depuis l’e-mail confirmé du compte. Demandez la suppression du compte classé Knucklebones Neon et n’indiquez le pseudo que s’il est nécessaire pour le retrouver.')] },
        { heading: 'Contrôle, journaux et sauvegardes', blocks: [p('Avant une demande externe, nous vérifions la propriété ainsi : {{deletionVerification}}. Les journaux de sécurité peuvent rester {{securityLogRetention}} et les sauvegardes {{backupRetention}} jusqu’à leur expiration normale.')] },
      ],
    },
  },
};
