import type { LegalContentBlock, LegalLocaleContent } from '../types.ts';

const p = (text: string): LegalContentBlock => ({ kind: 'paragraph', text });
const list = (...items: string[]): LegalContentBlock => ({ kind: 'list', items });

export const PT_LEGAL: LegalLocaleContent = {
  siteTitle: 'Informações legais do Knucklebones Neon',
  languageLabel: 'Idioma',
  pageNavigationLabel: 'Informações legais',
  languageNavigationLabel: 'Idiomas disponíveis',
  homeLabel: 'Voltar ao jogo',
  backLabel: 'Voltar',
  pendingFact: 'Aguardando verificação antes da publicação',
  pages: {
    imprint: {
      title: 'Informações do responsável',
      shortTitle: 'Informações legais',
      description: 'Informações do responsável e de contato do Knucklebones Neon.',
      intro: 'Dados da pessoa responsável por este projeto de jogo privado e sem fins comerciais.',
      sections: [
        { heading: 'Responsável conforme o § 18(1) MStV', blocks: [p('{{controllerName}}\n{{controllerStreet}}\n{{controllerPostalCity}}\n{{controllerCountry}}')] },
        { heading: 'Contato', blocks: [p('E-mail: {{publicEmail}}')] },
        { heading: 'Situação do projeto', blocks: [p('Este é um projeto pessoal gratuito, mantido por uma pessoa física. Não há empresa, registro comercial, número de IVA, profissão regulamentada, publicidade ou oferta paga a informar.')] },
      ],
    },
    privacy: {
      title: 'Aviso de privacidade',
      shortTitle: 'Privacidade',
      description: 'Como o Knucklebones Neon trata dados do dispositivo, da conta e de partidas ranqueadas.',
      intro: 'Este aviso descreve os dados usados no jogo offline, no PWA hospedado e nas partidas ranqueadas opcionais.',
      sections: [
        { heading: 'Controlador e contato', blocks: [p('{{controllerName}}, {{controllerStreet}}, {{controllerPostalCity}}, {{controllerCountry}}. E-mail: {{publicEmail}}.')] },
        { heading: 'Dados no seu dispositivo', blocks: [p('Preferências, estatísticas locais, sessão e uma cópia do seu perfil ficam no armazenamento local do navegador ou WebView. O PWA hospedado também usa Cache Storage para arquivos offline e um valor temporário de sessão para recuperar falhas de carregamento. Não usamos cookies de publicidade ou marketing.')] },
        { heading: 'Conta e partidas ranqueadas', blocks: [p('Ao iniciar uma partida ranqueada, é criada uma conta anônima no Supabase. Passamos a tratar o identificador da conta, apelido gerado ou escolhido, código do avatar, configurações, pontuação atual e máxima, dados do ranking, data de criação do perfil e histórico de partidas e jogadas. Se você ativar a recuperação por e-mail, o Supabase Auth também guarda esse endereço e {{smtpProvider}} envia as mensagens relacionadas.')] },
        { heading: 'Finalidades e bases legais', blocks: [p('Tratamos dados de conta, pareamento, partida, configurações e ranking para oferecer o serviço solicitado e preservar seus resultados (art. 6(1)(b) do GDPR).'), p('Tratamos dados operacionais e de segurança limitados para prevenir abuso, aplicar limites, diagnosticar falhas e proteger o serviço e outros jogadores (art. 6(1)(f) do GDPR).')] },
        { heading: 'Destinatários, regiões e transferências', blocks: [p('O Supabase fornece autenticação, banco de dados, Edge Functions e Realtime. A região do banco é {{supabaseDatabaseRegion}} e a das Edge Functions é {{supabaseFunctionsRegion}}.'), p('O Cloudflare Pages entrega o PWA hospedado. O escopo relevante desse tratamento é: {{cloudflareProcessingScope}}.'), p('No iOS, as opções Iniciar Sessão com a Apple e Game Center enviam pelos serviços da Apple identificadores da conta Apple ou do jogador da equipe e material de verificação assinado. A verificação do Game Center passa por um Worker da Cloudflare com limite de solicitações antes do Supabase; o aplicativo não recebe outros dados do perfil do Game Center.'), p('As garantias aplicáveis às transferências internacionais são: {{transferSafeguards}}. O aplicativo nativo usa arquivos web incluídos no próprio pacote.'), p('Não integramos SDK de publicidade ou análise comportamental nem script remoto de marketing ou análise. Os provedores de infraestrutura ainda podem criar logs operacionais, de segurança e de acesso.')] },
        { heading: 'O que outros jogadores veem', blocks: [p('Apelido, avatar, pontuação atual e máxima, posição no ranking ou participação no top 1%, vitórias, derrotas, partidas, melhor sequência, data de entrada e resultados ranqueados podem aparecer a adversários ou no ranking e nos cartões de jogador. O histórico detalhado fica restrito ao titular; participantes podem ver o registro da partida e das jogadas que compartilharam.')] },
        { heading: 'Retenção e exclusão', blocks: [p('Contas de convidado ou recuperadas permanecem até a exclusão. Após a resolução de uma partida ativa, a exclusão remove perfil, configurações, filas, ranking e histórico de partidas e jogadas. Se o Iniciar Sessão com a Apple estiver vinculado, a credencial de revogação armazenada é usada para remover o acesso; falhas temporárias são repetidas e, caso contrário, o aplicativo mostra instruções manuais. Preferências e estatísticas locais ficam no dispositivo até você limpar os dados do app ou site. Logs de segurança ficam por {{securityLogRetention}} e backups por {{backupRetention}}.')] },
        { heading: 'Seus direitos', blocks: [p('Você pode solicitar acesso, correção, exclusão, restrição, portabilidade ou se opor ao tratamento escrevendo para {{publicEmail}}. Também pode reclamar a uma autoridade supervisora.'), p('Autoridade competente: {{authorityName}}, {{authorityStreet}}, {{authorityPostalCity}}, {{authorityCountry}}.')] },
        { heading: 'Crianças e informações de idade', blocks: [p('O jogo atualmente não possui verificação de idade e não pede nem armazena data de nascimento. Isso descreve o comportamento atual do produto; não significa que as regras de privacidade infantil de todos os países estejam automaticamente atendidas.')] },
      ],
    },
    support: {
      title: 'Suporte e contato',
      shortTitle: 'Suporte',
      description: 'Como pedir ajuda técnica, de privacidade ou de conta para o Knucklebones Neon.',
      intro: 'Use o contato abaixo para suporte técnico, solicitações de privacidade ou dúvidas sobre a conta.',
      sections: [
        { heading: 'Contato', blocks: [p('E-mail: {{publicEmail}}')] },
        { heading: 'Como podemos ajudar', blocks: [list('Problemas técnicos e de acessibilidade', 'Dúvidas sobre a conta de partidas ranqueadas ou o apelido', 'Direitos de privacidade e exclusão da conta', 'Relatos de abuso ou problemas de segurança')] },
        { heading: 'O que informar', blocks: [p('Descreva o ocorrido e a versão web ou do aplicativo usada. Informe o apelido ou e-mail confirmado somente se necessário. Capturas de tela ajudam quando não mostram dados privados de outra pessoa.')] },
        { heading: 'Proteja suas credenciais', blocks: [p('Nunca envie senha, link de login, token de acesso ou recuperação nem dados privados de outra pessoa. Não pediremos essas credenciais por e-mail.')] },
        { heading: 'Tratamento das solicitações', blocks: [p('Usamos apenas os dados necessários para investigar. Pedidos de privacidade e exclusão exigem uma verificação proporcional de titularidade: {{deletionVerification}}.')] },
      ],
    },
    'delete-account': {
      title: 'Excluir sua conta',
      shortTitle: 'Excluir conta',
      description: 'Instruções dentro e fora do aplicativo para excluir uma conta de partidas ranqueadas do Knucklebones Neon.',
      intro: 'A exclusão da conta de partidas ranqueadas é permanente. Os dados offline locais são apagados separadamente.',
      sections: [
        { heading: 'Excluir no aplicativo', blocks: [list('Abra Perfil na tela inicial.', 'Abra os controles da conta.', 'Escolha Excluir conta e leia o aviso.', 'Confirme a exclusão permanente.')] },
        { heading: 'Dados removidos do servidor', blocks: [p('Após a resolução de uma partida ativa, a exclusão remove o usuário do Supabase e, em cascata, perfil, configurações, ranking, filas e histórico de partidas e jogadas. Essa identidade usada nas partidas ranqueadas, pontuação e histórico não podem ser restaurados.')] },
        { heading: 'Dados locais permanecem', blocks: [p('A exclusão encerra sua sessão e remove a sessão local da conta e a cópia do perfil em cache. Ela não remove preferências locais, estatísticas offline nem arquivos do aplicativo em cache deste dispositivo. Limpe o armazenamento do aplicativo nas configurações do aparelho ou os dados armazenados do site no navegador.')] },
        { heading: 'Solicitar fora do aplicativo', blocks: [p('Escreva para {{publicEmail}}, de preferência usando o e-mail confirmado da conta. Peça a exclusão da conta de partidas ranqueadas do Knucklebones Neon e informe o apelido apenas se necessário para localizá-la.')] },
        { heading: 'Verificação, logs e backups', blocks: [p('Antes de atender a um pedido externo, verificamos a titularidade assim: {{deletionVerification}}. Logs de segurança podem permanecer por {{securityLogRetention}} e cópias de backup por {{backupRetention}} até a expiração normal.')] },
      ],
    },
  },
};
