import type { CatalogShape } from '../../catalog-shape.ts';
import { enLearn } from '../en/learn.ts';

export const trLearn = {
  tutorial: {
    welcome: 'Knucklebones’a hoş geldin! Senin ızgaran ALTTA. YZ kendi ızgarasını doldurmadan sen zarlarla doldur — en yüksek toplam kazanır.',
    lesson1: '4 attın. + işaretleri her sütunun getireceği puanı gösterir — zarı bırakmak için bir sütuna dokun.',
    lesson2: 'Bir 4 daha! Aynı sütundaki eş zarlar çarpılır: iki 4, 8 değil 16 puan eder. İlk 4’ün üstüne koy.',
    lesson3: '5 attın ve YZ’nin orta sütununda bir 5 var. Onu yok etmek için zarını KENDİ orta sütununa yerleştir!',
    lesson4: 'İşte bu! Oyunun tamamı bu: eşleri üst üste koy, rakibinkileri parçala. Raundu bitir — en yüksek toplam kazanır.',
  },
  hub: {
    title: 'NASIL OYNANIR?',
    tutorial: 'Öğretici',
    tutorialBlurb: 'Yönlendirmeli ilk oyun — okumak yerine oynanan beş ders',
    rules: 'Kurallar',
    rulesBlurb: 'Puanlama, yok etme ve oyunun bitişi',
    modes: 'Oyun modları',
    modesBlurb: 'Çarkın seçebileceği tüm modlar ve değiştirdikleri',
    runes: 'Rünler',
    runesBlurb: 'Tüm güçler, hedefleri ve kullanım sayıları',
  },
  rules: {
    title: 'KURALLAR',
    goal: {
      heading: 'Amaç',
      body: '3×3 ızgaranı zarlarla doldur. <b>İki ızgaradan biri</b> dolduğunda oyun biter — en yüksek toplam kazanır.',
    },
    placing: {
      heading: 'Yerleştirme',
      body: 'Bir zar atar, sonra zarı bırakmak için <b>kendi</b> sütunlarından birine dokunursun. Atacağın sayıyı değil, yalnızca yerini seçebilirsin.',
    },
    multipliers: {
      heading: 'Sütun çarpanları',
      body: 'Aynı sütundaki eş zarlar çarpılır. Bir sütundaki iki 4 = <b>4×2×2 = 16</b>; 8 değil. Üç 4 = <b>4×3×3 = 36</b>.',
    },
    destruction: {
      heading: 'Yok etme',
      body: 'Bir zar yerleştirdiğinde <span class="k">rakibin karşı sütunundaki tüm eş zarlar yok edilir</span>. Sütunlar dikey olarak hizalıdır — senin sol sütunun rakibin sol sütununa bakar.',
    },
    reading: {
      heading: 'Tahtayı okuma',
      body: 'Her sütunun yanındaki işaretler güncel puanını, <b>×2</b>/<b>×3</b> ise çarpılan bir diziyi gösterir. En iyi yeri bulmak oyunun özüdür; <b>öğretici</b> ise her sütunun puan önizlemesini göstererek yönlendirmeli bir raund oynatır.',
    },
    runes: {
      heading: 'Rünler',
      body: 'Çevrimdışı oyunlarda oynanan zarın yanında bir <b>rün</b> dağıtılabilir. Yerel çok oyunculu oyunda altı rünün hepsi her zaman kullanılabilir; YZ’ye karşı yalnızca çevrimiçi topladığın rünleri kullanabilirsin. Varsayılan <b>yok</b> seçeneğidir; belirli bir rün veya <b>rastgele</b> seçeneği iki oyuncuya da aynı rünü, <b>rastgele 2</b> ise farklı rünleri verir. <b>Rün Ayini</b> modunda iki oyuncu aynı üç rünü görür, her biri gizlice birini seçer ve seçimler birlikte açılır. Yalnızca Rün Ayini, rün seçip açmak için düellodan önce duraklar. Seçtiğin rünü toplamak için dereceli bir Rün Ayini’ni onunla kazan; bu mod kuşanılan rünleri dikkate almaz. Sıradan dereceli maçlarda her oyuncu, bir kez GÜMÜŞ’e ulaştıktan sonra kuşandığı rünü kullanır; hiç GÜMÜŞ’e ulaşmamış veya yuvayı boş bırakmış oyuncunun rünü olmaz. Kendi zarında etkili bir rünü hemen kullanmak için rüne bas; sütun hedefleyen rünü sürükle veya aydınlatılmış bir sütuna dokun. Rün kullanmak bir hamle sayılmaz; ardından zarını yine yerleştirirsin. Tam liste <b>NASIL OYNANIR? → RÜNLER</b> bölümündedir.',
    },
    twoPlayers: {
      heading: 'İki oyuncu',
      body: 'Tek bir telefonu paylaşmak için <b>2 OYUNCU</b> seçeneğini, ardından oturma düzenini seç. <b>Telefonu ver</b>: hamleler arasında bir teslim ekranı görünür ve oynayan kişi altta olacak şekilde ızgaralar yer değiştirir. <b>Karşılıklı</b>: telefonu aranıza düz koyun — üst yarı Oyuncu 2 için çevrilir, sıralar kendiliğinden değişir ve dönen orta zarın bulunduğu parlak yarı kimin oynadığını gösterir.',
    },
  },
  library: {
    gameModes: 'OYUN MODLARI',
    runes: 'RÜNLER',
    openMode: '{{name}} kurallarını aç',
    openRune: '{{name}} ayrıntılarını aç',
  },
  firstRun: {
    title: 'İlk kez mi?',
    body: 'Öğretici, okumak yerine oynanan beş derslik yönlendirmeli bir oyundur. Yaklaşık bir dakika sürer ve bunu yalnızca bir kez görürsün.',
    play: 'Öğreticiyi oyna',
    startTutorial: 'Öğreticiyi başlat',
    skip: 'Atla, kuralları biliyorum',
  },
} satisfies CatalogShape<typeof enLearn>;
