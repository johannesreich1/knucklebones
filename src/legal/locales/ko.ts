import type { LegalContentBlock, LegalLocaleContent } from '../types.ts';

const p = (text: string): LegalContentBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalContentBlock => ({ kind: 'list', items });

export const KO_LEGAL: LegalLocaleContent = {
  siteTitle: 'Knucklebones Neon 법적 정보',
  languageLabel: '언어',
  pageNavigationLabel: '법적 정보',
  languageNavigationLabel: '지원 언어',
  homeLabel: '게임으로 돌아가기',
  backLabel: '뒤로',
  pendingFact: '게시 전 확인 대기 중',
  pages: {
    imprint: {
      title: '제공자 정보',
      shortTitle: '운영자 정보',
      description: 'Knucklebones Neon의 제공자 및 연락처 정보입니다.',
      intro: '이 개인적이고 비상업적인 게임 프로젝트의 책임자에 관한 정보입니다.',
      sections: [
        {
          heading: 'MStV 제18조 제1항에 따른 제공자',
          blocks: [p('{{controllerName}}\n{{controllerStreet}}\n{{controllerPostalCity}}\n{{controllerCountry}}')],
        },
        {
          heading: '연락처',
          blocks: [p('이메일: {{publicEmail}}')],
        },
        {
          heading: '프로젝트 성격',
          blocks: [p('이 프로젝트는 자연인이 운영하는 무료 개인 취미 프로젝트입니다. 여기에 공개해야 할 회사, 상업등기 항목, 부가가치세 식별번호, 규제 대상 직업, 광고 또는 유료 서비스는 없습니다.')],
        },
      ],
    },
    privacy: {
      title: '개인정보 처리 안내',
      shortTitle: '개인정보',
      description: 'Knucklebones Neon이 기기, 계정 및 랭크 매치 데이터를 처리하는 방식을 설명합니다.',
      intro: '이 안내는 오프라인 플레이, 호스팅된 PWA 및 선택형 랭크 플레이에서 사용하는 데이터를 설명합니다.',
      sections: [
        {
          heading: '개인정보처리자 및 연락처',
          blocks: [p('{{controllerName}}, {{controllerStreet}}, {{controllerPostalCity}}, {{controllerCountry}}. 이메일: {{publicEmail}}.')],
        },
        {
          heading: '기기에 저장되는 데이터',
          blocks: [p('환경설정, 로컬 통계, 세션 및 캐시된 프로필 상태는 브라우저 또는 WebView의 로컬 저장소에 남습니다. 호스팅된 PWA는 오프라인 앱 자산을 위해 Cache Storage를 사용하고 청크 로딩 실패 복구를 위해 임시 세션 값을 사용합니다. 광고 또는 마케팅 쿠키는 사용하지 않습니다.')],
        },
        {
          heading: '랭크 계정 및 매치 데이터',
          blocks: [p('랭크 플레이를 시작하면 Supabase 익명 계정이 생성됩니다. 이후 계정 식별자, 자동 생성하거나 정한 닉네임, 아바타 코드, 설정, 현재 및 최고 포인트 또는 평점, 랭킹 통계, 프로필 생성 시각, 매치 및 수 기록을 처리합니다. 이메일 복구를 선택하면 Supabase Auth가 해당 이메일 주소도 저장하고 {{smtpProvider}}가 관련 메시지를 전송합니다.')],
        },
        {
          heading: '처리 목적 및 법적 근거',
          blocks: [
            p('요청한 게임 서비스를 제공하고 결과를 보존하기 위해 계정, 매치메이킹, 매치, 설정 및 랭킹 데이터를 처리합니다(GDPR 제6조 제1항 (b)).'),
            p('악용 방지, 요청 제한 적용, 장애 진단, 서비스 및 다른 플레이어 보호를 위해 제한된 운영 및 보안 데이터를 처리합니다(GDPR 제6조 제1항 (f)).'),
          ],
        },
        {
          heading: '수신자, 지역 및 이전',
          blocks: [
            p('Supabase는 인증, 데이터베이스, Edge Function 및 Realtime 서비스를 제공합니다. 데이터베이스 지역은 {{supabaseDatabaseRegion}}이고 Edge Function 지역은 {{supabaseFunctionsRegion}}입니다.'),
            p('Cloudflare Pages는 호스팅된 PWA를 제공합니다. 관련 처리 범위는 {{cloudflareProcessingScope}}입니다.'),
            p('iOS에서는 선택 사항인 Apple 로그인 및 Game Center가 Apple 계정 또는 팀 플레이어 식별자와 서명된 검증 자료를 Apple 서비스를 통해 전송합니다. Game Center 검증은 Supabase에 도달하기 전에 요청 제한이 적용된 Cloudflare Worker를 거칩니다. 앱은 랭크 계정을 복구하거나 보호하는 데 필요한 안정적인 팀 플레이어 식별자 외의 Game Center 프로필 세부 정보를 받지 않습니다.'),
            p('관련 국제 이전에 사용되는 보호조치는 {{transferSafeguards}}입니다. 네이티브 앱은 Cloudflare에서 내려받지 않고 앱에 포함된 웹 자산을 불러옵니다.'),
            p('광고 또는 행동 분석 SDK와 원격으로 호스팅되는 마케팅 또는 분석 스크립트를 통합하지 않습니다. 다만 인프라 제공자가 운영, 보안 및 접근 로그를 생성할 수 있습니다.'),
          ],
        },
        {
          heading: '다른 플레이어에게 보이는 정보',
          blocks: [p('닉네임, 아바타, 현재 및 최고 포인트 또는 평점, 순위 또는 최고 등급, 승리, 패배, 게임 수, 최고 연승, 가입 시점 및 랭크 결과가 상대 또는 게임 내 랭킹과 플레이어 카드를 이용하는 사람에게 표시될 수 있습니다. 상세 기록은 계정 소유자만 볼 수 있으며, 매치 참가자는 함께한 매치와 수의 로그를 볼 수 있습니다.')],
        },
        {
          heading: '보관 및 삭제',
          blocks: [p('게스트 및 복구 계정은 삭제될 때까지 유지됩니다. 계정을 삭제하면 진행 중인 매치를 정산한 후 호스팅된 프로필, 설정, 랭킹 행, 대기열 행, 매치 및 수 기록이 삭제됩니다. Apple 로그인이 연결된 경우 저장된 철회 자격 증명으로 Apple 접근 권한을 제거합니다. 일시적 실패는 재시도하며 자동 철회를 완료할 수 없으면 앱에서 수동 제거 방법을 안내합니다. 로컬 환경설정과 통계는 앱 또는 사이트 데이터를 지울 때까지 기기에 남습니다. 보안 로그는 {{securityLogRetention}}, 백업은 {{backupRetention}} 동안 보관됩니다.')],
        },
        {
          heading: '이용자의 권리',
          blocks: [
            p('{{publicEmail}}에 연락하여 열람, 정정, 삭제, 처리 제한, 이동권을 요청하거나 처리에 이의를 제기할 수 있습니다. 감독 기관에 민원을 제기할 수도 있습니다.'),
            p('관할 기관: {{authorityName}}, {{authorityStreet}}, {{authorityPostalCity}}, {{authorityCountry}}.'),
          ],
        },
        {
          heading: '아동 및 연령 정보',
          blocks: [p('현재 게임에는 연령 확인 절차가 없으며 생년월일을 묻거나 저장하지 않습니다. 이 문구는 현재 제품의 동작을 설명할 뿐이며 모든 국가의 아동 개인정보 보호 요건을 자동으로 충족한다는 주장이 아닙니다.')],
        },
      ],
    },
    support: {
      title: '지원 및 연락처',
      shortTitle: '지원',
      description: 'Knucklebones Neon의 게임, 개인정보 또는 계정 지원을 요청하는 방법입니다.',
      intro: '기술 지원, 개인정보 관련 요청 또는 계정 질문은 아래 연락처를 이용하세요.',
      sections: [
        { heading: '연락처', blocks: [p('이메일: {{publicEmail}}')] },
        {
          heading: '지원 가능한 내용',
          blocks: [list('기술 문제 및 접근성 문제', '랭크 계정 또는 닉네임 관련 질문', '개인정보 권리 및 계정 삭제 요청', '악용 또는 보안 우려 신고')],
        },
        {
          heading: '포함할 내용',
          blocks: [p('발생한 일과 사용한 웹 또는 앱 버전을 설명하세요. 계정에 연결된 닉네임 또는 확인된 이메일은 필요한 경우에만 포함하세요. 다른 사람의 비공개 정보가 드러나지 않는다면 스크린샷도 유용합니다.')],
        },
        {
          heading: '자격 증명을 비공개로 유지하세요',
          blocks: [p('비밀번호, 로그인 링크, 접근 토큰, 복구 토큰 또는 다른 사람의 비공개 데이터를 절대 보내지 마세요. 당사는 이메일로 이러한 자격 증명을 요청하지 않습니다.')],
        },
        {
          heading: '요청 처리',
          blocks: [p('요청을 조사하는 데 필요한 최소한의 정보만 사용합니다. 개인정보 및 삭제 요청에는 다음과 같은 적절한 소유권 확인이 필요합니다: {{deletionVerification}}.')],
        },
      ],
    },
    'delete-account': {
      title: '계정 삭제',
      shortTitle: '계정 삭제',
      description: 'Knucklebones Neon 랭크 계정을 삭제하는 앱 내외의 방법입니다.',
      intro: '랭크 계정 삭제는 영구적입니다. 로컬 오프라인 데이터는 별도로 지워야 합니다.',
      sections: [
        {
          heading: '앱에서 삭제',
          blocks: [list('홈에서 프로필을 엽니다.', '계정 관리를 엽니다.', '계정 삭제를 선택하고 경고를 확인합니다.', '영구 삭제를 확정합니다.')],
        },
        {
          heading: '삭제되는 호스팅 데이터',
          blocks: [p('진행 중인 매치를 정산한 후 Supabase 사용자가 삭제되고 프로필, 설정, 랭킹 및 대기열 행, 매치 및 수 기록이 연쇄적으로 삭제됩니다. 해당 랭크 ID, 평점 또는 기록은 이후 복구할 수 없습니다.')],
        },
        {
          heading: '로컬 데이터는 남습니다',
          blocks: [p('삭제하면 로그아웃되고 로컬 계정 세션과 캐시된 프로필이 지워집니다. 이 기기의 로컬 환경설정, 오프라인 통계 또는 캐시된 앱 자산은 지워지지 않습니다. 남은 항목을 제거하려면 기기 설정에서 앱 저장 공간을 지우거나 브라우저에서 이 사이트의 저장 데이터를 지우세요.')],
        },
        {
          heading: '앱 밖에서 삭제 요청',
          blocks: [p('가능하면 확인된 계정 이메일에서 {{publicEmail}}로 연락하세요. Knucklebones Neon 랭크 계정 삭제를 원한다고 밝히고, 계정을 찾는 데 필요한 경우에만 닉네임을 포함하세요.')],
        },
        {
          heading: '확인, 로그 및 백업',
          blocks: [p('외부 요청을 처리하기 전에 다음 방식으로 소유권을 확인합니다: {{deletionVerification}}. 제공자 보안 로그는 {{securityLogRetention}}, 백업 사본은 {{backupRetention}} 동안 정기 만료 시점까지 남을 수 있습니다.')],
        },
      ],
    },
  },
};
