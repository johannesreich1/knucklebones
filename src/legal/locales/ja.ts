import type { LegalContentBlock, LegalLocaleContent } from '../types.ts';

const p = (text: string): LegalContentBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalContentBlock => ({ kind: 'list', items });

export const JA_LEGAL: LegalLocaleContent = {
  siteTitle: 'Knucklebones Neon 法的情報',
  languageLabel: '言語',
  pageNavigationLabel: '法的情報',
  languageNavigationLabel: '利用可能な言語',
  homeLabel: 'ゲームに戻る',
  backLabel: '戻る',
  pendingFact: '公開前の確認待ち',
  pages: {
    imprint: {
      title: '提供者情報',
      shortTitle: '運営者情報',
      description: 'Knucklebones Neonの提供者および連絡先に関する情報です。',
      intro: 'この個人的かつ非営利のゲームプロジェクトの責任者に関する情報です。',
      sections: [
        {
          heading: 'MStV第18条第1項に基づく提供者',
          blocks: [p('{{controllerName}}\n{{controllerStreet}}\n{{controllerPostalCity}}\n{{controllerCountry}}')],
        },
        {
          heading: '連絡先',
          blocks: [p('メール：{{publicEmail}}')],
        },
        {
          heading: 'プロジェクトの形態',
          blocks: [p('本プロジェクトは、自然人が運営する無料の個人的な趣味のプロジェクトです。ここに掲載すべき会社、商業登記、付加価値税登録番号、規制対象の職業、広告、または有料サービスはありません。')],
        },
      ],
    },
    privacy: {
      title: 'プライバシー通知',
      shortTitle: 'プライバシー',
      description: 'Knucklebones Neonによる端末、アカウント、ランク戦データの取り扱いについて説明します。',
      intro: 'この通知は、オフラインプレイ、ホスト型PWA、および任意のランク戦で使用するデータについて説明するものです。',
      sections: [
        {
          heading: '管理者および連絡先',
          blocks: [p('{{controllerName}}, {{controllerStreet}}, {{controllerPostalCity}}, {{controllerCountry}}。メール：{{publicEmail}}。')],
        },
        {
          heading: '端末上のデータ',
          blocks: [p('設定、ローカル統計、セッション、およびキャッシュされたプロフィールの状態は、ブラウザまたはWebViewのローカルストレージに保存されます。ホスト型PWAは、オフライン用アプリアセットのためにCache Storageを、チャンク読み込み失敗からの復旧のために一時的なセッション値を使用します。広告またはマーケティング用Cookieは使用しません。')],
        },
        {
          heading: 'ランク戦のアカウントおよび対戦データ',
          blocks: [p('ランク戦を開始すると、Supabaseの匿名アカウントが作成されます。その後、アカウント識別子、自動生成または取得したニックネーム、アバターコード、設定、現在および最高のポイントまたは評価、ランキング統計、プロフィール作成日時、対戦と手順の履歴を処理します。メールによる復旧を選んだ場合、Supabase Authはそのメールアドレスも保存し、{{smtpProvider}}が関連メッセージを配信します。')],
        },
        {
          heading: '目的および法的根拠',
          blocks: [
            p('要求されたゲームサービスを提供し、その結果を保持するため、アカウント、マッチメイキング、対戦、設定、およびランキングのデータを処理します（GDPR第6条第1項(b)）。'),
            p('不正利用の防止、レート制限の適用、障害の診断、ならびにサービスと他のプレイヤーの保護のため、限定的な運用およびセキュリティデータを処理します（GDPR第6条第1項(f)）。'),
          ],
        },
        {
          heading: '受領者、地域、および移転',
          blocks: [
            p('Supabaseは、認証、データベース、Edge Function、およびRealtimeサービスを提供します。データベースのリージョンは{{supabaseDatabaseRegion}}、Edge Functionのリージョンは{{supabaseFunctionsRegion}}です。'),
            p('Cloudflare Pagesはホスト型PWAを配信します。関連する処理範囲は{{cloudflareProcessingScope}}です。'),
            p('iOSでは、任意の「Appleでサインイン」およびGame Centerにより、Appleアカウントまたはチームプレイヤー識別子と署名済み検証情報がAppleのサービスを通じて送信されます。Game Centerの検証はSupabaseへ到達する前にレート制限付きのCloudflare Workerを経由します。アプリが受け取るGame Centerプロフィール情報は、ランク戦アカウントの復旧または保護に必要な安定したチームプレイヤー識別子に限られます。'),
            p('該当する国際移転に使用する保護措置は{{transferSafeguards}}です。ネイティブアプリはCloudflareからダウンロードせず、同梱されたWebアセットを読み込みます。'),
            p('広告SDK、行動分析SDK、およびリモートでホストされるマーケティングまたは分析スクリプトは組み込んでいません。ただし、インフラ提供者が運用、セキュリティ、およびアクセスログを作成する場合があります。'),
          ],
        },
        {
          heading: '他のプレイヤーに表示される情報',
          blocks: [p('ニックネーム、アバター、現在および最高のポイントまたは評価、順位または最高位、勝敗数、ゲーム数、最高連勝、参加時期、およびランク戦の結果は、対戦相手、ゲーム内ランキングやプレイヤーカードの利用者に表示される場合があります。詳細な履歴は本人だけが閲覧できますが、対戦参加者は共有する対戦と手順のログを閲覧できます。')],
        },
        {
          heading: '保存期間および削除',
          blocks: [p('ゲストアカウントおよび復旧済みアカウントは、削除されるまで保持されます。アカウントを削除すると、進行中の対戦を確定した後、ホスト側のプロフィール、設定、ランキング行、待機列行、対戦と手順の履歴が削除されます。「Appleでサインイン」を連携している場合、保存された失効用認証情報を使ってAppleアクセスを削除します。一時的な失敗は再試行され、自動失効を完了できない場合はアプリに手動削除の手順が表示されます。ローカル設定と統計は、アプリまたはサイトのデータを消去するまで端末に残ります。セキュリティログの保存期間は{{securityLogRetention}}、バックアップの保存期間は{{backupRetention}}です。')],
        },
        {
          heading: 'お客様の権利',
          blocks: [
            p('{{publicEmail}}へ連絡することにより、アクセス、訂正、消去、処理の制限、データポータビリティを請求し、または処理に異議を申し立てることができます。また、監督機関へ苦情を申し立てることもできます。'),
            p('管轄当局：{{authorityName}}, {{authorityStreet}}, {{authorityPostalCity}}, {{authorityCountry}}。'),
          ],
        },
        {
          heading: '子どもおよび年齢情報',
          blocks: [p('現在、このゲームには年齢確認がなく、生年月日を尋ねたり保存したりしません。この記述は現在の製品動作を記録するものであり、各国の子どものプライバシー要件を自動的に満たすと主張するものではありません。')],
        },
      ],
    },
    support: {
      title: 'サポートおよび連絡先',
      shortTitle: 'サポート',
      description: 'Knucklebones Neonのゲーム、プライバシー、またはアカウントに関するサポートの依頼方法です。',
      intro: '技術的な支援、プライバシーに関する請求、またはアカウントに関する質問は、以下の連絡先をご利用ください。',
      sections: [
        { heading: '連絡先', blocks: [p('メール：{{publicEmail}}')] },
        {
          heading: 'サポートできる内容',
          blocks: [list('技術的な問題およびアクセシビリティの問題', 'ランク戦アカウントまたはニックネームに関する質問', 'プライバシー権およびアカウント削除の請求', '不正利用またはセキュリティ上の懸念の報告')],
        },
        {
          heading: '記載する内容',
          blocks: [p('発生した事象と、使用したWeb版またはアプリ版のバージョンを記載してください。ニックネームまたはアカウントに紐づく確認済みメールアドレスは、必要な場合に限り記載してください。他人の非公開情報が写っていない場合、スクリーンショットも役立ちます。')],
        },
        {
          heading: '認証情報を送信しないでください',
          blocks: [p('パスワード、サインインリンク、アクセストークン、復旧トークン、または他人の非公開データは絶対に送信しないでください。当方がこれらの認証情報をメールで求めることはありません。')],
        },
        {
          heading: '依頼の取り扱い',
          blocks: [p('依頼の調査に必要な最小限の情報のみを使用します。プライバシーおよび削除の請求では、所有者であることを相応の方法で確認します：{{deletionVerification}}。')],
        },
      ],
    },
    'delete-account': {
      title: 'アカウントを削除',
      shortTitle: 'アカウント削除',
      description: 'Knucklebones Neonのランク戦アカウントを削除するための、アプリ内および外部からの手順です。',
      intro: 'ランク戦アカウントの削除は永久的です。ローカルのオフラインデータは別途消去します。',
      sections: [
        {
          heading: 'アプリ内で削除する',
          blocks: [list('ホームから「プロフィール」を開きます。', 'アカウント管理を開きます。', '「アカウントを削除」を選び、警告を確認します。', '永久削除を確定します。')],
        },
        {
          heading: '削除されるホスト側データ',
          blocks: [p('進行中の対戦を確定した後、Supabaseユーザーが削除され、プロフィール、設定、ランキングと待機列の行、対戦と手順の履歴も連鎖的に削除されます。そのランク戦のID、評価、履歴を後から復元することはできません。')],
        },
        {
          heading: 'ローカルデータは残ります',
          blocks: [p('削除するとサインアウトし、ローカルのアカウントセッションとキャッシュ済みプロフィールが消去されます。この端末のローカル設定、オフライン統計、またはキャッシュ済みアプリアセットは消去されません。残った項目を削除するには、端末の設定でアプリのストレージを消去するか、ブラウザでこのサイトの保存データを消去してください。')],
        },
        {
          heading: 'アプリ外から削除を依頼する',
          blocks: [p('可能な場合は、確認済みのアカウントメールから{{publicEmail}}へご連絡ください。Knucklebones Neonのランク戦アカウントの削除を希望する旨を明記し、アカウントを特定するために必要な場合に限りニックネームを記載してください。')],
        },
        {
          heading: '本人確認、ログ、およびバックアップ',
          blocks: [p('外部からの依頼に対応する前に、次の方法で所有者を確認します：{{deletionVerification}}。提供者のセキュリティログは{{securityLogRetention}}、バックアップコピーは{{backupRetention}}、通常の有効期限まで残る場合があります。')],
        },
      ],
    },
  },
};
