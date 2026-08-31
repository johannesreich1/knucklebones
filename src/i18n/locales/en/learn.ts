export const enLearn = {
  tutorial: {
    welcome: 'Welcome to Knucklebones! Your grid is the BOTTOM one. Fill it with dice before the AI fills theirs — highest total wins.',
    lesson1: 'You rolled a 4. The +pills preview what each column would score — tap any column to drop it in.',
    lesson2: 'Another 4! Matching dice in one column multiply: two 4s score 16, not 8. Stack it on your first 4.',
    lesson3: 'You rolled a 5 — and the AI has a 5 in their middle column. Place yours in YOUR middle column to destroy theirs!',
    lesson4: 'Boom. That is the whole game: stack matches, smash theirs. Finish the round — highest total wins.',
  },
  hub: {
    title: 'HOW TO PLAY',
    tutorial: 'Tutorial',
    tutorialBlurb: 'A guided first game — five lessons, played not read',
    rules: 'The rules',
    rulesBlurb: 'Scoring, destruction and how a game ends',
    modes: 'Game modes',
    modesBlurb: 'Every mode the dial can land on, and what it changes',
    runes: 'Runes',
    runesBlurb: 'Every power, its targets and how many casts you get',
  },
  rules: {
    title: 'RULES',
    goal: {
      heading: 'Goal',
      body: 'Fill your 3×3 grid with dice. When <b>either</b> grid is full the game ends — highest total wins.',
    },
    placing: {
      heading: 'Placing',
      body: 'You roll a die, then tap one of <b>your</b> columns to drop it in. You cannot choose the roll, only where it lands.',
    },
    multipliers: {
      heading: 'Column multipliers',
      body: 'Matching dice in the same column multiply. Two 4s in a column = <b>4×2×2 = 16</b>, not 8. Three 4s = <b>4×3×3 = 36</b>.',
    },
    destruction: {
      heading: 'Destruction',
      body: 'Place a die and <span class="k">every matching die in the opponent\'s facing column is destroyed</span>. Columns line up vertically — your left column faces their left column.',
    },
    reading: {
      heading: 'Reading the board',
      body: 'The chips beside each column show its running score, and <b>×2</b>/<b>×3</b> marks a multiplied stack. Working out the best placement is the game — but the <b>tutorial</b> plays a guided round with point previews on every column.',
    },
    runes: {
      heading: 'Runes',
      body: 'Offline games can deal a <b>rune</b> beside the die in play. Local multiplayer always has all six; versus AI, you can use only runes collected online. <b>None</b> is the default; named picks and <b>random</b> give both players matching runes, while <b>random 2</b> gives them different ones. In <b>Rune Ritual</b>, both players see the same three runes, each secretly chooses one, and both choices are revealed together. Only Rune Ritual pauses before the duel to choose and reveal runes. Win a ranked Rune Ritual to collect your chosen rune; Rune Ritual ignores equipment. Ordinary ranked uses each player’s equipped rune after that player has reached SILVER once; a player who has never reached SILVER or leaves the seat empty has no rune. Press a rune that acts on your die to cast it immediately; drag or tap a column-targeting rune onto a lit column. A cast is not a move, so your die still lands afterwards. The full roster lives under <b>HOW TO PLAY → RUNES</b>.',
    },
    twoPlayers: {
      heading: 'Two players',
      body: 'Pick <b>2 PLAYERS</b> to share one phone, then choose how you sit. <b>Pass phone</b>: a pass card appears between turns and the grids swap so whoever is playing is on the bottom. <b>Face to face</b>: lay the phone flat between you — the top half is turned for Player 2, turns switch on their own, and the bright half with the rotating centre die shows who is up.',
    },
  },
  library: {
    gameModes: 'GAME MODES',
    runes: 'RUNES',
    openMode: 'Open {{name}} rules',
    openRune: 'Open {{name}} details',
  },
  firstRun: {
    title: 'First time?',
    body: 'The tutorial is one guided game — five lessons, played rather than read. It takes about a minute, and you only ever see this once.',
    play: 'Play the tutorial',
    startTutorial: 'Start tutorial',
    skip: 'Skip, I know the rules',
  },
} as const;
