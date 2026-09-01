import type { LegalContentBlock, LegalLocaleContent } from '../types.ts';

const p = (text: string): LegalContentBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalContentBlock => ({ kind: 'list', items });

export const ID_LEGAL: LegalLocaleContent = {
  siteTitle: 'Informasi hukum Knucklebones Neon',
  languageLabel: 'Bahasa',
  pageNavigationLabel: 'Informasi hukum',
  languageNavigationLabel: 'Bahasa yang tersedia',
  homeLabel: 'Kembali ke permainan',
  backLabel: 'Kembali',
  pendingFact: 'Menunggu verifikasi sebelum dipublikasikan',
  pages: {
    imprint: {
      title: 'Informasi penyedia',
      shortTitle: 'Informasi hukum',
      description: 'Informasi penyedia dan kontak untuk Knucklebones Neon.',
      intro: 'Informasi tentang pihak yang bertanggung jawab atas proyek permainan pribadi dan nonkomersial ini.',
      sections: [
        {
          heading: 'Penyedia berdasarkan § 18(1) MStV',
          blocks: [p('{{controllerName}}\n{{controllerStreet}}\n{{controllerPostalCity}}\n{{controllerCountry}}')],
        },
        {
          heading: 'Kontak',
          blocks: [p('Email: {{publicEmail}}')],
        },
        {
          heading: 'Status proyek',
          blocks: [p('Ini adalah proyek hobi pribadi dan gratis yang dijalankan oleh orang perseorangan. Tidak ada perusahaan, pencatatan dalam register komersial, nomor identifikasi PPN, profesi yang diatur, iklan, atau penawaran berbayar yang perlu dicantumkan di sini.')],
        },
      ],
    },
    privacy: {
      title: 'Pemberitahuan privasi',
      shortTitle: 'Privasi',
      description: 'Cara Knucklebones Neon memproses data perangkat, akun, dan pertandingan peringkat.',
      intro: 'Pemberitahuan ini menjelaskan data yang digunakan untuk permainan offline, PWA yang dihosting, dan permainan peringkat opsional.',
      sections: [
        {
          heading: 'Pengendali dan kontak',
          blocks: [p('{{controllerName}}, {{controllerStreet}}, {{controllerPostalCity}}, {{controllerCountry}}. Email: {{publicEmail}}.')],
        },
        {
          heading: 'Data di perangkat Anda',
          blocks: [p('Preferensi, statistik lokal, sesi, dan status profil dalam cache tetap berada di penyimpanan lokal browser atau WebView. PWA yang dihosting juga menggunakan Cache Storage untuk aset aplikasi offline dan nilai sesi sementara guna memulihkan kegagalan pemuatan bagian aplikasi. Kami tidak menggunakan cookie iklan atau pemasaran.')],
        },
        {
          heading: 'Data akun dan pertandingan peringkat',
          blocks: [p('Memulai permainan peringkat akan membuat akun anonim Supabase. Kami kemudian memproses pengenal akun, nama panggilan yang dibuat atau diklaim, kode avatar, pengaturan, poin atau peringkat saat ini dan tertinggi, statistik papan peringkat, waktu pembuatan profil, serta riwayat pertandingan dan langkah. Jika Anda memilih pemulihan melalui email, Supabase Auth juga menyimpan alamat email tersebut dan {{smtpProvider}} mengirimkan pesan terkait.')],
        },
        {
          heading: 'Tujuan dan dasar hukum',
          blocks: [
            p('Kami memproses data akun, pencarian lawan, pertandingan, pengaturan, dan papan peringkat untuk menyediakan layanan permainan yang diminta serta menyimpan hasilnya (Pasal 6(1)(b) GDPR).'),
            p('Kami memproses data operasional dan keamanan secara terbatas untuk mencegah penyalahgunaan, menerapkan batas permintaan, mendiagnosis kegagalan, serta melindungi layanan dan pemain lain (Pasal 6(1)(f) GDPR).'),
          ],
        },
        {
          heading: 'Penerima, wilayah, dan transfer',
          blocks: [
            p('Supabase menyediakan layanan autentikasi, basis data, Edge Function, dan Realtime. Wilayah basis data adalah {{supabaseDatabaseRegion}} dan wilayah Edge Function adalah {{supabaseFunctionsRegion}}.'),
            p('Cloudflare Pages menyediakan PWA yang dihosting. Cakupan pemrosesan yang relevan adalah: {{cloudflareProcessingScope}}.'),
            p('Di iOS, fitur opsional Masuk dengan Apple dan Game Center mengirimkan pengenal akun Apple atau team-player serta materi verifikasi bertanda tangan melalui layanan Apple. Verifikasi Game Center melewati Cloudflare Worker dengan batas permintaan sebelum mencapai Supabase; aplikasi tidak menerima detail profil Game Center selain pengenal team-player stabil yang diperlukan untuk memulihkan atau melindungi akun peringkat.'),
            p('Perlindungan yang digunakan untuk transfer internasional terkait adalah: {{transferSafeguards}}. Aplikasi native memuat aset web yang disertakan dalam bundel, bukan mengunduhnya dari Cloudflare.'),
            p('Kami tidak mengintegrasikan SDK periklanan atau analitik perilaku maupun skrip pemasaran atau analitik yang dihosting dari jarak jauh. Penyedia infrastruktur tetap dapat membuat log operasional, keamanan, dan akses.'),
          ],
        },
        {
          heading: 'Yang dapat dilihat pemain lain',
          blocks: [p('Nama panggilan, avatar, poin atau peringkat saat ini dan tertinggi, posisi atau puncak peringkat, jumlah kemenangan, kekalahan, pertandingan, rentetan terbaik, waktu bergabung, dan hasil pertandingan peringkat dapat dilihat oleh lawan atau pengguna papan peringkat dan kartu pemain dalam game. Riwayat terperinci hanya dapat dilihat oleh pemiliknya; peserta pertandingan dapat membaca catatan pertandingan dan langkah yang mereka jalani bersama.')],
        },
        {
          heading: 'Penyimpanan dan penghapusan',
          blocks: [p('Akun tamu dan akun yang dipulihkan tetap tersimpan sampai dihapus. Setelah pertandingan aktif diselesaikan, penghapusan akun akan menghapus profil yang dihosting, pengaturan, baris papan peringkat, baris antrean, serta riwayat pertandingan dan langkah. Jika Masuk dengan Apple terhubung, kredensial pencabutan yang tersimpan digunakan untuk menghapus akses Apple; kegagalan sementara akan dicoba lagi, dan aplikasi memberikan petunjuk penghapusan manual jika pencabutan otomatis tidak dapat diselesaikan. Preferensi dan statistik lokal tetap berada di perangkat sampai Anda menghapus data aplikasi atau situs. Log keamanan disimpan selama {{securityLogRetention}} dan cadangan selama {{backupRetention}}.')],
        },
        {
          heading: 'Hak Anda',
          blocks: [
            p('Anda dapat meminta akses, perbaikan, penghapusan, pembatasan, portabilitas, atau mengajukan keberatan atas pemrosesan dengan menulis ke {{publicEmail}}. Anda juga dapat mengajukan pengaduan kepada otoritas pengawas.'),
            p('Otoritas yang berwenang: {{authorityName}}, {{authorityStreet}}, {{authorityPostalCity}}, {{authorityCountry}}.'),
          ],
        },
        {
          heading: 'Anak-anak dan informasi usia',
          blocks: [p('Saat ini permainan tidak memiliki batasan usia serta tidak meminta atau menyimpan tanggal lahir. Pernyataan ini mencatat perilaku produk saat ini; ini bukan klaim bahwa persyaratan privasi anak di setiap negara otomatis telah dipenuhi.')],
        },
      ],
    },
    support: {
      title: 'Dukungan dan kontak',
      shortTitle: 'Dukungan',
      description: 'Cara meminta dukungan permainan, privasi, atau akun untuk Knucklebones Neon.',
      intro: 'Gunakan kontak di bawah ini untuk bantuan teknis, permintaan privasi, atau pertanyaan akun.',
      sections: [
        { heading: 'Kontak', blocks: [p('Email: {{publicEmail}}')] },
        {
          heading: 'Hal yang dapat kami bantu',
          blocks: [list('Masalah teknis dan aksesibilitas', 'Pertanyaan tentang akun peringkat atau nama panggilan', 'Permintaan hak privasi dan penghapusan akun', 'Laporan penyalahgunaan atau masalah keamanan')],
        },
        {
          heading: 'Informasi yang perlu disertakan',
          blocks: [p('Jelaskan apa yang terjadi, versi web atau aplikasi yang digunakan, dan—hanya jika diperlukan—nama panggilan atau email terkonfirmasi yang terhubung ke akun. Tangkapan layar dapat membantu selama tidak mengungkapkan informasi pribadi orang lain.')],
        },
        {
          heading: 'Jaga kerahasiaan kredensial',
          blocks: [p('Jangan pernah mengirim kata sandi, tautan masuk, token akses, token pemulihan, atau data pribadi orang lain. Kami tidak akan meminta kredensial tersebut melalui email.')],
        },
        {
          heading: 'Penanganan permintaan',
          blocks: [p('Kami hanya menggunakan informasi minimum yang diperlukan untuk menyelidiki permintaan. Permintaan privasi dan penghapusan memerlukan pemeriksaan kepemilikan yang sepadan: {{deletionVerification}}.')],
        },
      ],
    },
    'delete-account': {
      title: 'Hapus akun Anda',
      shortTitle: 'Hapus akun',
      description: 'Petunjuk di dalam aplikasi dan dari luar aplikasi untuk menghapus akun peringkat Knucklebones Neon.',
      intro: 'Penghapusan akun peringkat bersifat permanen. Data offline lokal dihapus secara terpisah.',
      sections: [
        {
          heading: 'Hapus di dalam aplikasi',
          blocks: [list('Buka Profil dari Beranda.', 'Buka kontrol akun.', 'Pilih Hapus akun dan baca peringatannya.', 'Konfirmasikan penghapusan permanen.')],
        },
        {
          heading: 'Data yang dihosting akan dihapus',
          blocks: [p('Setelah pertandingan aktif diselesaikan, penghapusan akan menghapus pengguna Supabase dan secara berantai menghapus profil, pengaturan, baris papan peringkat dan antrean, serta riwayat pertandingan dan langkah. Identitas, nilai peringkat, dan riwayat permainan peringkat tersebut tidak dapat dipulihkan setelahnya.')],
        },
        {
          heading: 'Data lokal tetap tersimpan',
          blocks: [p('Penghapusan akan mengeluarkan Anda serta membersihkan sesi akun lokal dan profil dalam cache. Tindakan ini tidak menghapus preferensi lokal, statistik offline, atau aset aplikasi dalam cache di perangkat ini. Untuk menghapus data yang tersisa, bersihkan penyimpanan aplikasi di pengaturan perangkat atau hapus data tersimpan situs ini di browser.')],
        },
        {
          heading: 'Minta penghapusan dari luar aplikasi',
          blocks: [p('Tulis ke {{publicEmail}} menggunakan email akun yang telah dikonfirmasi jika memungkinkan. Nyatakan bahwa Anda ingin menghapus akun peringkat Knucklebones Neon dan sertakan nama panggilan hanya jika diperlukan untuk menemukan akun.')],
        },
        {
          heading: 'Verifikasi, log, dan cadangan',
          blocks: [p('Sebelum menindaklanjuti permintaan eksternal, kami memverifikasi kepemilikan sebagai berikut: {{deletionVerification}}. Log keamanan penyedia dapat tetap tersimpan selama {{securityLogRetention}} dan salinan cadangan selama {{backupRetention}} sampai masa penyimpanan rutinnya berakhir.')],
        },
      ],
    },
  },
};
