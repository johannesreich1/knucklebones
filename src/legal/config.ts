import type { LegalPublicationConfig, LocalizedLegalFact } from './types.ts';
import { ACCOUNT_REQUEST_VERIFICATION } from './request-verification.ts';
import { IONOS_MAIL_RETENTION } from './mail-retention.ts';
import { IONOS_SUPPORT_PROCESSING } from './support-processing.ts';

const GERMANY_NAMES: LocalizedLegalFact = Object.freeze({
  en: 'Germany',
  pt: 'Alemanha',
  es: 'Alemania',
  de: 'Deutschland',
  fr: 'Allemagne',
  it: 'Germania',
  pl: 'Niemcy',
  tr: 'Almanya',
  id: 'Jerman',
  ja: 'ドイツ',
  ko: '독일',
});

// Supabase organization backup.retention_days, read on 2026-09-05 (docs/LEGAL.md).
const SUPABASE_BACKUP_WINDOW_DAYS = '7';

/**
 * Publication is deliberately fail-closed. Changing this to `ready` makes the
 * build validate every fact and review flag before it can emit a public page.
 */
export const LEGAL_RELEASE: LegalPublicationConfig = {
  status: 'draft',
  canonicalOrigin: 'https://knucklebones-asg.pages.dev',
  facts: {
    noticeDate: '2026-09-05',
    // Named copies pinned to the retention migrations by tests/legal.test.ts.
    commandReceiptRetentionDays: '7',
    appleRevocationRetryDays: '7',
    // Live cron schedule verified on noticeDate; this is polling, not backoff.
    appleRevocationScheduleMinutes: '5',
    controllerName: 'Johannes Reich',
    controllerStreet: 'Krumpterstr. 4',
    controllerPostalCity: '81543 München',
    controllerCountry: GERMANY_NAMES,
    publicEmail: 'support@knucklebones.gg',
    authorityName: 'Bayerisches Landesamt für Datenschutzaufsicht (BayLDA)',
    authorityStreet: 'Promenade 18',
    authorityPostalCity: '91522 Ansbach',
    authorityCountry: GERMANY_NAMES,
    supabaseDatabaseRegion: 'eu-central-1 (Frankfurt)',
    supabaseFunctionsRegion: {
      en: 'Server functions can run in Supabase regions worldwide; they are not restricted to the database region.',
      pt: 'As funções de servidor podem ser executadas em regiões da Supabase no mundo todo; não ficam restritas à região do banco de dados.',
      es: 'Las funciones de servidor pueden ejecutarse en regiones de Supabase de todo el mundo; no se limitan a la región de la base de datos.',
      de: 'Serverfunktionen können weltweit in Supabase-Regionen ausgeführt werden; sie sind nicht auf die Datenbankregion beschränkt.',
      fr: 'Les fonctions serveur peuvent être exécutées dans les régions Supabase du monde entier ; elles ne sont pas limitées à la région de la base de données.',
      it: 'Le funzioni server possono essere eseguite nelle regioni Supabase di tutto il mondo; non sono limitate alla regione del database.',
      pl: 'Funkcje serwerowe mogą działać w regionach Supabase na całym świecie; nie są ograniczone do regionu bazy danych.',
      tr: 'Sunucu işlevleri dünya genelindeki Supabase bölgelerinde çalışabilir; veritabanı bölgesiyle sınırlı değildir.',
      id: 'Fungsi server dapat berjalan di wilayah Supabase di seluruh dunia; fungsi ini tidak terbatas pada wilayah basis data.',
      ja: 'サーバー機能は世界各地のSupabaseリージョンで実行される場合があり、データベースのリージョンには限定されません。',
      ko: '서버 기능은 전 세계 Supabase 리전에서 실행될 수 있으며 데이터베이스 리전으로 제한되지 않습니다.',
    },
    cloudflareProcessingScope: {
      en: 'Cloudflare delivers the hosted game through its global network. Its Game Center gateway processes signed identity checks and the connecting IP address for request limiting, including for native apps. Pages Web Analytics, persistent Worker logs and log exports are not configured. Cloudflare may still process its own operational and security data.',
      pt: 'A Cloudflare distribui o jogo hospedado por sua rede global. Seu gateway do Game Center processa verificações de identidade assinadas e o endereço IP da conexão para limitar solicitações, inclusive nos apps nativos. Pages Web Analytics, logs persistentes do Worker e exportações de logs não estão configurados. A Cloudflare ainda pode tratar dados próprios de operação e segurança.',
      es: 'Cloudflare distribuye el juego alojado mediante su red global. Su pasarela de Game Center procesa comprobaciones de identidad firmadas y la dirección IP de conexión para limitar solicitudes, también en las apps nativas. Pages Web Analytics, los registros persistentes del Worker y las exportaciones de registros no están configurados. Cloudflare puede seguir tratando sus propios datos operativos y de seguridad.',
      de: 'Cloudflare liefert das gehostete Spiel über sein weltweites Netzwerk aus. Der Game-Center-Zugangsdienst verarbeitet signierte Identitätsprüfungen und die IP-Adresse der Verbindung zur Begrenzung von Anfragen, auch bei nativen Apps. Pages Web Analytics, dauerhafte Worker-Protokolle und Protokollexporte sind nicht eingerichtet. Cloudflare kann weiterhin eigene Betriebs- und Sicherheitsdaten verarbeiten.',
      fr: 'Cloudflare distribue le jeu hébergé par son réseau mondial. Sa passerelle Game Center traite les vérifications d’identité signées et l’adresse IP de connexion pour limiter les requêtes, y compris dans les apps natives. Pages Web Analytics, les journaux persistants du Worker et les exports de journaux ne sont pas configurés. Cloudflare peut toutefois traiter ses propres données de fonctionnement et de sécurité.',
      it: 'Cloudflare distribuisce il gioco ospitato tramite la propria rete globale. Il suo gateway Game Center elabora verifiche di identità firmate e l’indirizzo IP della connessione per limitare le richieste, anche nelle app native. Pages Web Analytics, i log persistenti del Worker e le esportazioni dei log non sono configurati. Cloudflare può comunque trattare propri dati operativi e di sicurezza.',
      pl: 'Cloudflare dostarcza hostowaną grę przez swoją globalną sieć. Brama Game Center przetwarza podpisane potwierdzenia tożsamości oraz adres IP połączenia w celu ograniczania żądań, także w aplikacjach natywnych. Pages Web Analytics, trwałe logi Workera i eksport logów nie są skonfigurowane. Cloudflare może nadal przetwarzać własne dane operacyjne i dotyczące bezpieczeństwa.',
      tr: 'Cloudflare, barındırılan oyunu küresel ağı üzerinden sunar. Game Center ağ geçidi, yerel uygulamalarda da imzalı kimlik doğrulamalarını ve istekleri sınırlamak için bağlantının IP adresini işler. Pages Web Analytics, kalıcı Worker günlükleri ve günlük dışa aktarımları yapılandırılmamıştır. Cloudflare yine de kendi işletim ve güvenlik verilerini işleyebilir.',
      id: 'Cloudflare mengirimkan game yang dihosting melalui jaringan globalnya. Gateway Game Center memproses pemeriksaan identitas bertanda tangan dan alamat IP koneksi untuk membatasi permintaan, termasuk dari aplikasi native. Pages Web Analytics, log Worker persisten, dan ekspor log tidak dikonfigurasi. Cloudflare masih dapat memproses data operasional dan keamanannya sendiri.',
      ja: 'Cloudflareは世界規模のネットワークでホストされたゲームを配信します。Game Centerゲートウェイは、ネイティブアプリからの接続も含め、署名付きの本人確認データと、リクエストを制限するための接続元IPアドレスを処理します。Pages Web Analytics、永続的なWorkerログ、ログのエクスポートは設定されていません。Cloudflareが独自の運用・セキュリティデータを処理する場合はあります。',
      ko: 'Cloudflare는 글로벌 네트워크를 통해 호스팅된 게임을 제공합니다. Game Center 게이트웨이는 네이티브 앱의 연결을 포함하여 서명된 신원 확인 데이터와 요청 제한을 위한 접속 IP 주소를 처리합니다. Pages Web Analytics, 영구 Worker 로그 및 로그 내보내기는 구성되어 있지 않습니다. Cloudflare는 자체 운영 및 보안 데이터를 처리할 수 있습니다.',
    },
    // Project logs have a verified seven-day access window. Provider-internal
    // security logs are a separate category and still need retention criteria.
    securityLogRetention: null,
    backupRetention: {
      en: `Supabase keeps daily database backups for a configured recovery window of ${SUPABASE_BACKUP_WINDOW_DAYS} days. Copies of deleted data can remain in those backups until they rotate out. Account deletion does not change each existing backup individually. Mail-provider retention is described separately.`,
      pt: `A Supabase mantém backups diários do banco de dados com uma janela de recuperação configurada de ${SUPABASE_BACKUP_WINDOW_DAYS} dias. Cópias de dados excluídos podem permanecer nesses backups até sua substituição no ciclo regular. A exclusão da conta não altera cada backup existente individualmente. A retenção pelo provedor de e-mail é descrita separadamente.`,
      es: `Supabase conserva copias de seguridad diarias de la base de datos con un período de recuperación configurado de ${SUPABASE_BACKUP_WINDOW_DAYS} días. Las copias de datos eliminados pueden permanecer en ellas hasta su sustitución en el ciclo habitual. Eliminar la cuenta no modifica cada copia de seguridad existente por separado. La conservación por parte del proveedor de correo se describe por separado.`,
      de: `Supabase hält tägliche Datenbanksicherungen für ein eingerichtetes Wiederherstellungsfenster von ${SUPABASE_BACKUP_WINDOW_DAYS} Tagen vor. Kopien gelöschter Daten können darin bis zum regulären Austausch der Sicherungen verbleiben. Eine Kontolöschung verändert nicht jede vorhandene Sicherung einzeln. Die Aufbewahrung beim E-Mail-Anbieter wird gesondert beschrieben.`,
      fr: `Supabase conserve des sauvegardes quotidiennes de la base de données pour une période de restauration configurée de ${SUPABASE_BACKUP_WINDOW_DAYS} jours. Des copies de données supprimées peuvent y rester jusqu’à leur remplacement dans le cycle habituel. La suppression du compte ne modifie pas individuellement chaque sauvegarde existante. La conservation par le fournisseur de messagerie est décrite séparément.`,
      it: `Supabase conserva backup giornalieri del database con un periodo di ripristino configurato di ${SUPABASE_BACKUP_WINDOW_DAYS} giorni. Copie dei dati eliminati possono rimanere nei backup fino alla loro sostituzione nel ciclo ordinario. L’eliminazione dell’account non modifica singolarmente ogni backup esistente. La conservazione da parte del fornitore di posta elettronica è descritta separatamente.`,
      pl: `Supabase przechowuje codzienne kopie zapasowe bazy danych z ustawionym okresem przywracania wynoszącym ${SUPABASE_BACKUP_WINDOW_DAYS} dni. Kopie usuniętych danych mogą w nich pozostać do czasu zastąpienia kopii zapasowych w zwykłym cyklu. Usunięcie konta nie zmienia osobno każdej istniejącej kopii zapasowej. Przechowywanie przez dostawcę poczty opisano oddzielnie.`,
      tr: `Supabase, veritabanının günlük yedeklerini yapılandırılmış ${SUPABASE_BACKUP_WINDOW_DAYS} günlük geri yükleme dönemi için saklar. Silinen verilerin kopyaları, yedekler olağan döngüde değiştirilene kadar bu yedeklerde kalabilir. Hesabın silinmesi, mevcut her yedeği ayrı ayrı değiştirmez. E-posta sağlayıcısının saklama uygulaması ayrıca açıklanmıştır.`,
      id: `Supabase menyimpan cadangan harian basis data dengan jangka pemulihan yang dikonfigurasi selama ${SUPABASE_BACKUP_WINDOW_DAYS} hari. Salinan data yang dihapus dapat tetap berada di cadangan tersebut sampai cadangan diganti dalam siklus rutin. Penghapusan akun tidak mengubah setiap cadangan yang sudah ada satu per satu. Penyimpanan oleh penyedia email dijelaskan secara terpisah.`,
      ja: `Supabaseは、設定された${SUPABASE_BACKUP_WINDOW_DAYS}日間の復元期間に対応するデータベースの日次バックアップを保持します。削除したデータのコピーは、通常のサイクルでバックアップが入れ替わるまで残る場合があります。アカウントを削除しても、既存の各バックアップが個別に書き換えられるわけではありません。メール事業者の保存期間は別途説明しています。`,
      ko: `Supabase는 설정된 ${SUPABASE_BACKUP_WINDOW_DAYS}일의 복원 기간에 해당하는 일일 데이터베이스 백업을 보관합니다. 삭제된 데이터의 사본은 백업이 정기적으로 교체될 때까지 남아 있을 수 있습니다. 계정 삭제가 기존 백업을 각각 변경하지는 않습니다. 이메일 제공업체의 보관 방식은 별도로 설명합니다.`,
    },
    transferSafeguards: null,
    // Owner purchased this launch provider; SMTP activation/delivery is still
    // unverified. Publication remains draft until the processor checks pass.
    smtpProvider: 'IONOS SE (Mail Basic 5)',
    smtpRetention: IONOS_MAIL_RETENTION,
    supportProcessing: IONOS_SUPPORT_PROCESSING,
    supportRetention: null,
    deletionVerification: ACCOUNT_REQUEST_VERIFICATION,
  },
  checks: {
    legalReviewComplete: false,
    translationsReviewed: false,
    processorFactsVerified: false,
    childPrivacyReviewed: false,
    deletionWorkflowVerified: false,
  },
};
