import type { CatalogShape } from '../../catalog-shape.ts';
import { enLearn } from '../en/learn.ts';

export const ptLearn = {
  tutorial: {
    welcome: 'Bem-vindo ao Knucklebones! Sua grade é a de BAIXO. Encha-a de dados antes da IA — o maior total vence.',
    lesson1: 'Você tirou 4. As cápsulas + mostram quanto cada coluna passaria a valer — toque numa para colocar o dado.',
    lesson2: 'Outro 4! Dados iguais na mesma coluna multiplicam: dois 4 valem 16, não 8. Empilhe-o no primeiro 4.',
    lesson3: 'Você tirou 5, e a IA tem um 5 na coluna central. Coloque o seu na SUA coluna central para destruí-lo!',
    lesson4: 'Pronto. Empilhe iguais e destrua os do rival. Termine a rodada — o maior total vence.',
  },
  hub: {
    title: 'COMO JOGAR',
    tutorial: 'Tutorial',
    tutorialBlurb: 'Uma primeira partida guiada — cinco lições para jogar',
    rules: 'As regras',
    rulesBlurb: 'Pontuação, destruição e como a partida termina',
    modes: 'Modos de jogo',
    modesBlurb: 'Todos os modos do seletor e o que cada um muda',
    runes: 'Runas',
    runesBlurb: 'Cada poder, seus alvos e quantas vezes pode ser usado',
  },
  rules: {
    title: 'REGRAS',
    goal: {
      heading: 'Objetivo',
      body: 'Encha sua grade 3×3 com dados. Quando <b>uma das duas</b> grades ficar cheia, a partida termina — o maior total vence.',
    },
    placing: {
      heading: 'Colocação',
      body: 'Você lança um dado e toca numa das <b>suas</b> colunas para colocá-lo. Não pode escolher o resultado, apenas onde ele cai.',
    },
    multipliers: {
      heading: 'Multiplicadores de coluna',
      body: 'Dados iguais na mesma coluna multiplicam. Dois 4 numa coluna = <b>4×2×2 = 16</b>, não 8. Três 4 = <b>4×3×3 = 36</b>.',
    },
    destruction: {
      heading: 'Destruição',
      body: 'Ao colocar um dado, <span class="k">todos os dados iguais na coluna oposta do rival são destruídos</span>. As colunas se alinham na vertical: sua coluna esquerda enfrenta a esquerda do rival.',
    },
    reading: {
      heading: 'Entenda o tabuleiro',
      body: 'Os marcadores ao lado das colunas mostram a pontuação, e <b>×2</b>/<b>×3</b> indicam uma pilha multiplicada. Encontrar a melhor jogada faz parte do jogo, mas o <b>tutorial</b> guia uma rodada com a prévia de pontos em cada coluna.',
    },
    runes: {
      heading: 'Runas',
      body: 'Partidas offline podem dar uma <b>runa</b> ao lado do dado. No multijogador local, as seis estão sempre disponíveis; contra a IA, só é possível usar runas coletadas online. <b>Nenhuma</b> é o padrão; opções nomeadas e <b>aleatória</b> dão runas iguais aos dois jogadores, enquanto <b>aleatória 2</b> dá runas diferentes. Na <b>Prova de Runas</b>, os dois escolhem em segredo entre as mesmas três runas e revelam juntos. Vença uma Prova ranqueada para coletar a runa escolhida; outros modos ranqueados ignoram runas equipadas. Pressione uma runa que age no dado para usá-la de imediato; arraste ou toque numa runa de coluna e depois numa coluna iluminada. Usar uma runa não é uma jogada, então você ainda coloca o dado. A lista completa está em <b>COMO JOGAR → RUNAS</b>.',
    },
    twoPlayers: {
      heading: 'Dois jogadores',
      body: 'Escolha <b>2 JOGADORES</b> para dividir um celular e indique como estão sentados. <b>Passar celular</b>: um cartão aparece entre os turnos e as grades trocam de lugar para quem joga ficar embaixo. <b>Cara a cara</b>: deixe o celular deitado entre vocês; a metade superior vira para o Jogador 2, os turnos mudam sozinhos, e a metade iluminada com o dado central girando mostra quem joga.',
    },
  },
  library: {
    gameModes: 'MODOS DE JOGO',
    runes: 'RUNAS',
    openMode: 'Abrir regras de {{name}}',
    openRune: 'Abrir detalhes de {{name}}',
  },
  firstRun: {
    title: 'Primeira vez?',
    body: 'O tutorial é uma partida guiada com cinco lições práticas. Leva cerca de um minuto e aparece só uma vez.',
    play: 'Jogar o tutorial',
    startTutorial: 'Iniciar tutorial',
    skip: 'Pular, já sei as regras',
  },
} satisfies CatalogShape<typeof enLearn>;
