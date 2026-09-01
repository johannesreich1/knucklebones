import type { CatalogShape } from '../../catalog-shape.ts';
import { enLearn } from '../en/learn.ts';

export const idLearn = {
  tutorial: {
    welcome: 'Selamat datang di Knucklebones! Petak milik Anda berada di BAWAH. Isi dengan dadu sebelum AI mengisi petaknya — total tertinggi menang.',
    lesson1: 'Anda mendapat 4. Penanda + menampilkan perkiraan skor setiap kolom — ketuk kolom mana saja untuk menaruh dadu.',
    lesson2: 'Dapat 4 lagi! Dadu yang sama dalam satu kolom melipatgandakan skor: dua angka 4 bernilai 16, bukan 8. Tumpuk di atas angka 4 pertama.',
    lesson3: 'Anda mendapat 5 — dan AI memiliki 5 di kolom tengahnya. Taruh dadu Anda di kolom tengah MILIK ANDA untuk menghancurkan dadu AI!',
    lesson4: 'Begitulah seluruh permainannya: tumpuk angka yang sama, hancurkan milik lawan. Selesaikan ronde — total tertinggi menang.',
  },
  hub: {
    title: 'CARA BERMAIN',
    tutorial: 'Tutorial',
    tutorialBlurb: 'Permainan pertama dengan panduan — lima pelajaran untuk dimainkan',
    rules: 'Aturan',
    rulesBlurb: 'Skor, penghancuran, dan cara permainan berakhir',
    modes: 'Mode permainan',
    modesBlurb: 'Setiap mode yang dapat dipilih roda dan perubahan aturannya',
    runes: 'Rune',
    runesBlurb: 'Setiap kekuatan, sasaran, dan jumlah penggunaannya',
  },
  rules: {
    title: 'ATURAN',
    goal: {
      heading: 'Tujuan',
      body: 'Isi petak 3×3 Anda dengan dadu. Saat <b>salah satu</b> petak penuh, permainan berakhir — total tertinggi menang.',
    },
    placing: {
      heading: 'Menaruh dadu',
      body: 'Anda mengocok dadu, lalu mengetuk salah satu kolom <b>milik Anda</b> untuk menaruhnya. Anda tidak dapat memilih hasil dadu, hanya tempatnya.',
    },
    multipliers: {
      heading: 'Pengali kolom',
      body: 'Dadu yang sama dalam satu kolom melipatgandakan skor. Dua angka 4 dalam satu kolom = <b>4×2×2 = 16</b>, bukan 8. Tiga angka 4 = <b>4×3×3 = 36</b>.',
    },
    destruction: {
      heading: 'Penghancuran',
      body: 'Taruh sebuah dadu dan <span class="k">semua dadu dengan angka yang sama di kolom lawan yang berhadapan akan dihancurkan</span>. Kolom berjajar secara vertikal — kolom kiri Anda berhadapan dengan kolom kiri lawan.',
    },
    reading: {
      heading: 'Membaca papan',
      body: 'Penanda di samping setiap kolom menampilkan skornya, sedangkan <b>×2</b>/<b>×3</b> menandai tumpukan yang dilipatgandakan. Menentukan penempatan terbaik adalah inti permainan — tetapi <b>tutorial</b> memandu satu ronde dengan perkiraan poin di setiap kolom.',
    },
    runes: {
      heading: 'Rune',
      body: 'Permainan offline dapat memberikan sebuah <b>rune</b> di samping dadu yang sedang dimainkan. Permainan multipemain lokal selalu menyediakan keenam rune; saat melawan AI, Anda hanya dapat memakai rune yang dikumpulkan secara online. <b>Tanpa</b> adalah pilihan awal; pilihan bernama dan <b>acak</b> memberi kedua pemain rune yang sama, sedangkan <b>acak 2</b> memberi rune yang berbeda. Dalam <b>Ritual Rune</b>, kedua pemain melihat tiga rune yang sama, masing-masing memilih satu secara rahasia, lalu kedua pilihan dibuka bersamaan. Hanya Ritual Rune yang berhenti sebelum duel untuk memilih dan membuka rune. Menangkan Ritual Rune berperingkat untuk mengumpulkan rune pilihan Anda; Ritual Rune mengabaikan perlengkapan. Pertandingan peringkat biasa memakai rune yang dipasang setelah pemain tersebut pernah mencapai PERAK; pemain yang belum pernah mencapai PERAK atau membiarkan slot kosong tidak memakai rune. Tekan rune yang bekerja pada dadu Anda untuk langsung menggunakannya; seret atau ketuk rune bersasaran kolom ke kolom yang menyala. Menggunakan rune bukan satu giliran, jadi dadu Anda tetap harus ditaruh setelahnya. Daftar lengkap tersedia di <b>CARA BERMAIN → RUNE</b>.',
    },
    twoPlayers: {
      heading: 'Dua pemain',
      body: 'Pilih <b>2 PEMAIN</b> untuk berbagi satu ponsel, lalu pilih posisi duduk. <b>Oper ponsel</b>: kartu pengoperan muncul di antara giliran dan petak bertukar agar pemain aktif selalu berada di bawah. <b>Berhadapan</b>: letakkan ponsel mendatar di antara Anda — bagian atas diputar untuk Pemain 2, giliran berganti otomatis, dan bagian terang dengan dadu tengah yang berputar menunjukkan siapa yang bermain.',
    },
  },
  library: {
    gameModes: 'MODE PERMAINAN',
    runes: 'RUNE',
    openMode: 'Buka aturan {{name}}',
    openRune: 'Buka detail {{name}}',
  },
  firstRun: {
    title: 'Baru pertama kali?',
    body: 'Tutorial adalah satu permainan berpanduan — lima pelajaran yang dimainkan, bukan dibaca. Waktunya sekitar satu menit dan hanya muncul sekali.',
    play: 'Mainkan tutorial',
    startTutorial: 'Mulai tutorial',
    skip: 'Lewati, saya sudah tahu aturannya',
  },
} satisfies CatalogShape<typeof enLearn>;
