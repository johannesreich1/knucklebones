import type { LegalContentBlock, LegalLocaleContent } from '../types.ts';

const p = (text: string): LegalContentBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalContentBlock => ({ kind: 'list', items });

export const TR_LEGAL: LegalLocaleContent = {
  siteTitle: 'Knucklebones Neon yasal bilgileri',
  languageLabel: 'Dil',
  pageNavigationLabel: 'Yasal bilgiler',
  languageNavigationLabel: 'Kullanılabilir diller',
  homeLabel: 'Oyuna dön',
  backLabel: 'Geri',
  pendingFact: 'Yayımlanmadan önce doğrulama bekleniyor',
  pages: {
    imprint: {
      title: 'Sağlayıcı bilgileri',
      shortTitle: 'Yasal bilgiler',
      description: 'Knucklebones Neon sağlayıcı ve iletişim bilgileri.',
      intro: 'Bu özel ve ticari olmayan oyun projesinden sorumlu kişi hakkında bilgiler.',
      sections: [
        { heading: 'MStV § 18(1) uyarınca sağlayıcı', blocks: [p('{{controllerName}}\n{{controllerStreet}}\n{{controllerPostalCity}}\n{{controllerCountry}}')] },
        { heading: 'İletişim', blocks: [p('E-posta: {{publicEmail}}')] },
        { heading: 'Projenin durumu', blocks: [p('Bu proje, bir gerçek kişi tarafından yürütülen ücretsiz ve özel bir hobi projesidir. Burada yayımlanması gereken bir şirket, ticaret sicili kaydı, KDV kimlik numarası, düzenlemeye tabi meslek, reklam veya ücretli teklif yoktur.')] },
      ],
    },
    privacy: {
      title: 'Gizlilik bildirimi',
      shortTitle: 'Gizlilik',
      description: 'Knucklebones Neon’un cihaz, hesap ve dereceli maç verilerini nasıl işlediği.',
      intro: 'Bu bildirim, çevrimdışı oyun, barındırılan PWA ve isteğe bağlı dereceli oyun sırasında kullanılan verileri açıklar.',
      sections: [
        { heading: 'Veri sorumlusu ve iletişim', blocks: [p('{{controllerName}}, {{controllerStreet}}, {{controllerPostalCity}}, {{controllerCountry}}. E-posta: {{publicEmail}}.')] },
        { heading: 'Cihazındaki veriler', blocks: [p('Tercihler, yerel istatistikler, oturum ve önbelleğe alınan profil durumu tarayıcının veya WebView’in yerel depolamasında kalır. Barındırılan PWA ayrıca çevrimdışı uygulama varlıkları için Cache Storage’ı ve başarısız parça yüklemesinden kurtulmak için geçici bir oturum değerini kullanır. Reklam veya pazarlama çerezleri kullanmıyoruz.')] },
        { heading: 'Dereceli hesap ve maç verileri', blocks: [p('Dereceli oyunu başlatmak anonim bir Supabase hesabı oluşturur. Ardından hesap tanımlayıcısını, oluşturulan veya alınan takma adı, avatar kodunu, ayarları, mevcut ve en yüksek puan veya dereceyi, sıralama istatistiklerini, profil oluşturma zamanını ve maç ile hamle geçmişini işleriz. E-postayla kurtarmayı seçersen Supabase Auth bu e-posta adresini de saklar ve ilgili iletileri {{smtpProvider}} gönderir.')] },
        { heading: 'Amaçlar ve hukuki dayanaklar', blocks: [p('Hesap, eşleştirme, maç, ayar ve sıralama verilerini, istenen oyun hizmetini sunmak ve sonuçlarını korumak amacıyla işleriz (GDPR Madde 6(1)(b)).'), p('Sınırlı operasyon ve güvenlik verilerini kötüye kullanımı önlemek, hız sınırlarını uygulamak, hataları teşhis etmek ve hizmet ile diğer oyuncuları korumak amacıyla işleriz (GDPR Madde 6(1)(f)).')] },
        { heading: 'Alıcılar, bölgeler ve aktarımlar', blocks: [p('Supabase kimlik doğrulama, veritabanı, Edge Functions ve Realtime hizmetlerini sağlar. Veritabanı bölgesi {{supabaseDatabaseRegion}}, Edge Functions bölgesi ise {{supabaseFunctionsRegion}} şeklindedir.'), p('Cloudflare Pages, barındırılan PWA’yı sunar. İlgili işleme kapsamı: {{cloudflareProcessingScope}}.'), p('iOS’ta isteğe bağlı Apple ile giriş ve Game Center özellikleri, Apple hizmetleri üzerinden Apple hesabı veya takım oyuncusu tanımlayıcılarını ve imzalı doğrulama materyalini gönderir. Game Center doğrulaması Supabase’e ulaşmadan önce hız sınırı uygulanmış bir Cloudflare Worker’dan geçer; uygulama, dereceli hesabı geri yüklemek veya korumak için gereken kararlı takım oyuncusu tanımlayıcısı dışında Game Center profil ayrıntılarını almaz.'), p('İlgili uluslararası aktarımlarda kullanılan güvenceler: {{transferSafeguards}}. Yerel uygulama, web varlıklarını Cloudflare’dan indirmek yerine paketine dâhil edilen varlıkları yükler.'), p('Reklam veya davranış analizi SDK’sı ya da uzaktan barındırılan pazarlama veya analiz betiği kullanmıyoruz. Altyapı sağlayıcıları yine de operasyon, güvenlik ve erişim günlükleri oluşturabilir.')] },
        { heading: 'Diğer oyuncuların görebilecekleri', blocks: [p('Takma ad, avatar, mevcut ve en yüksek puan veya derece, sıra veya zirve, galibiyetler, mağlubiyetler, oyunlar, en iyi seri, üyelik başlangıç zamanı ve dereceli sonuçlar; rakiplere veya oyun içi sıralama ve oyuncu kartlarını kullanan kişilere görünebilir. Ayrıntılı geçmiş yalnızca sahibine açıktır; maçın katılımcıları ortak maç ve hamle kayıtlarını okuyabilir.')] },
        { heading: 'Saklama ve silme', blocks: [p('Misafir ve kurtarılmış hesaplar silinene kadar kalır. Hesap silme, etkin bir maç sonuçlandıktan sonra barındırılan profili, ayarları, sıralama ve kuyruk satırlarını, maç ve hamle geçmişini kaldırır. Apple ile giriş bağlıysa saklanan iptal kimlik bilgisi Apple erişimini kaldırmak için kullanılır; geçici hatalar yeniden denenir ve otomatik iptal tamamlanamazsa uygulama elle kaldırma talimatları verir. Yerel tercihler ve istatistikler, uygulama veya site verilerini temizleyene kadar cihazda kalır. Güvenlik günlükleri {{securityLogRetention}}, yedekler ise {{backupRetention}} süreyle saklanır.')] },
        { heading: 'Hakların', blocks: [p('{{publicEmail}} adresine yazarak erişim, düzeltme, silme, işlemeyi kısıtlama veya veri taşınabilirliği talep edebilir ya da işlemeye itiraz edebilirsin. Ayrıca bir denetim makamına şikâyette bulunabilirsin.'), p('Yetkili makam: {{authorityName}}, {{authorityStreet}}, {{authorityPostalCity}}, {{authorityCountry}}.')] },
        { heading: 'Çocuklar ve yaş bilgileri', blocks: [p('Oyunda şu anda yaş kapısı yoktur; doğum tarihi sorulmaz veya saklanmaz. Bu ifade ürünün mevcut davranışını kayda geçirir; her ülkenin çocuk gizliliği gerekliliklerinin kendiliğinden karşılandığı iddiası değildir.')] },
      ],
    },
    support: {
      title: 'Destek ve iletişim',
      shortTitle: 'Destek',
      description: 'Knucklebones Neon için oyun, gizlilik veya hesap desteği isteme yolları.',
      intro: 'Teknik yardım, gizlilik talepleri veya hesap soruları için aşağıdaki iletişim bilgisini kullan.',
      sections: [
        { heading: 'İletişim', blocks: [p('E-posta: {{publicEmail}}')] },
        { heading: 'Yardım edebileceğimiz konular', blocks: [list('Teknik sorunlar ve erişilebilirlik sorunları', 'Dereceli hesap veya takma ad soruları', 'Gizlilik hakları ve hesap silme talepleri', 'Kötüye kullanım veya güvenlik endişesi bildirimleri')] },
        { heading: 'Eklenecek bilgiler', blocks: [p('Ne olduğunu ve kullandığın web veya uygulama sürümünü açıkla; yalnızca gerektiğinde hesaba bağlı takma adı veya doğrulanmış e-postayı ekle. Başka bir kişinin özel bilgilerini göstermiyorsa ekran görüntüleri yararlı olabilir.')] },
        { heading: 'Giriş bilgilerini gizli tut', blocks: [p('Parola, oturum açma bağlantısı, erişim belirteci, kurtarma belirteci veya başka bir kişinin özel verilerini asla gönderme. Bu giriş bilgilerini e-posta ile istemeyiz.')] },
        { heading: 'Taleplerin işlenmesi', blocks: [p('Talebi araştırmak için gereken en az miktarda bilgiyi kullanırız. Gizlilik ve silme talepleri, ölçülü bir hesap sahipliği kontrolü gerektirir: {{deletionVerification}}.')] },
      ],
    },
    'delete-account': {
      title: 'Hesabını sil',
      shortTitle: 'Hesabı sil',
      description: 'Bir Knucklebones Neon dereceli hesabını uygulama içinde veya dışında silme talimatları.',
      intro: 'Dereceli hesabı silmek kalıcıdır. Yerel çevrimdışı veriler ayrı olarak temizlenir.',
      sections: [
        { heading: 'Uygulama içinde silme', blocks: [list('Ana sayfadan Profil’i aç.', 'Hesap kontrollerini aç.', 'Hesabı sil seçeneğini belirle ve uyarıyı incele.', 'Kalıcı silme işlemini onayla.')] },
        { heading: 'Kaldırılan barındırılmış veriler', blocks: [p('Etkin bir maç sonuçlandıktan sonra silme işlemi Supabase kullanıcısını; buna bağlı olarak profili, ayarları, sıralama ve kuyruk satırlarını, maç ve hamle geçmişini kaldırır. Bu dereceli kimlik, derece veya geçmiş daha sonra geri yüklenemez.')] },
        { heading: 'Yerel veriler kalır', blocks: [p('Silme işlemi oturumunu kapatır, yerel hesap oturumunu ve önbelleğe alınmış profili temizler. Bu cihazdaki yerel tercihleri, çevrimdışı istatistikleri veya önbelleğe alınmış uygulama varlıklarını temizlemez. Kalan öğeleri kaldırmak için cihaz ayarlarından uygulamanın depolamasını veya tarayıcıdan bu sitenin saklanan verilerini temizle.')] },
        { heading: 'Uygulama dışında silme talebi', blocks: [p('Mümkünse doğrulanmış hesap e-postasından {{publicEmail}} adresine yaz. Knucklebones Neon dereceli hesabının silinmesini istediğini belirt ve takma adı yalnızca hesabı bulmak için gerekliyse ekle.')] },
        { heading: 'Doğrulama, günlükler ve yedekler', blocks: [p('Harici bir talebi yerine getirmeden önce hesap sahipliğini şu şekilde doğrularız: {{deletionVerification}}. Sağlayıcı güvenlik günlükleri {{securityLogRetention}}, yedek kopyalar ise {{backupRetention}} süreyle rutin sona erme tarihine kadar kalabilir.')] },
      ],
    },
  },
};
