import type { CatalogShape } from '../../catalog-shape.ts';
import { enLearn } from '../en/learn.ts';

export const plLearn = {
  tutorial: {
    welcome: 'Witaj w Knucklebones! Twoja plansza jest NA DOLE. Zapełnij ją kośćmi, zanim SI zapełni swoją — wygrywa najwyższa suma.',
    lesson1: 'Wyrzucasz 4. Znaczniki + pokazują wynik każdej kolumny — dotknij dowolnej, aby umieścić kość.',
    lesson2: 'Kolejna 4! Takie same kości w jednej kolumnie mnożą wynik: dwie 4 dają 16, nie 8. Połóż ją na pierwszej 4.',
    lesson3: 'Wyrzucasz 5, a SI ma 5 w środkowej kolumnie. Umieść swoją w TWOJEJ środkowej kolumnie, aby zniszczyć tamtą!',
    lesson4: 'Bum. To cała gra: łącz takie same kości i niszcz kości rywala. Dokończ rundę — wygrywa najwyższa suma.',
  },
  hub: {
    title: 'JAK GRAĆ',
    tutorial: 'Samouczek',
    tutorialBlurb: 'Pierwsza gra z przewodnikiem — pięć lekcji do rozegrania',
    rules: 'Zasady',
    rulesBlurb: 'Punktacja, niszczenie i zakończenie gry',
    modes: 'Tryby gry',
    modesBlurb: 'Wszystkie tryby koła i ich wpływ na grę',
    runes: 'Runy',
    runesBlurb: 'Wszystkie moce, ich cele i liczba użyć',
  },
  rules: {
    title: 'ZASADY',
    goal: {
      heading: 'Cel',
      body: 'Zapełnij kośćmi swoją planszę 3×3. Gdy <b>którakolwiek</b> plansza jest pełna, gra się kończy — wygrywa najwyższa suma.',
    },
    placing: {
      heading: 'Umieszczanie',
      body: 'Rzucasz kością, a potem dotykasz jednej ze <b>swoich</b> kolumn, aby ją tam umieścić. Nie wybierasz wyniku rzutu, tylko miejsce.',
    },
    multipliers: {
      heading: 'Mnożniki kolumn',
      body: 'Takie same kości w jednej kolumnie mnożą wynik. Dwie 4 w kolumnie = <b>4×2×2 = 16</b>, a nie 8. Trzy 4 = <b>4×3×3 = 36</b>.',
    },
    destruction: {
      heading: 'Niszczenie',
      body: 'Gdy umieścisz kość, <span class="k">wszystkie takie same kości w naprzeciwległej kolumnie rywala zostają zniszczone</span>. Kolumny leżą pionowo naprzeciw siebie — twoja lewa kolumna odpowiada lewej kolumnie rywala.',
    },
    reading: {
      heading: 'Odczytywanie planszy',
      body: 'Znaczniki obok kolumn pokazują ich bieżący wynik, a <b>×2</b>/<b>×3</b> oznacza pomnożony stos. Wybór najlepszego miejsca to sedno gry, ale <b>samouczek</b> prowadzi przez rundę i pokazuje przewidywane punkty dla każdej kolumny.',
    },
    runes: {
      heading: 'Runy',
      body: 'W grze offline obok aktywnej kości może pojawić się <b>runa</b>. W lokalnej grze wieloosobowej zawsze dostępnych jest wszystkich sześć; przeciw SI możesz używać tylko run zdobytych online. Domyślnie wybrany jest <b>brak</b>; konkretna runa lub opcja <b>losowa</b> daje obojgu taką samą runę, a <b>losowe 2</b> daje różne. W <b>Rytuale Run</b> oboje widzicie te same trzy runy, każde potajemnie wybiera jedną, a wybory zostają odkryte razem. Tylko Rytuał Run zatrzymuje grę przed pojedynkiem na wybór i odkrycie run. Wygraj rankingowy Rytuał Run ze swoją runą, aby ją zdobyć; wyposażenie nie ma w nim znaczenia. W zwykłym rankingu każdy używa wyposażonej runy po jednokrotnym osiągnięciu SREBRA; gracz, który nigdy nie osiągnął SREBRA albo zostawił miejsce puste, nie ma runy. Naciśnij runę działającą na twoją kość, aby użyć jej od razu; przeciągnij runę celującą w kolumnę lub dotknij nią podświetlonej kolumny. Użycie runy nie jest ruchem, więc potem nadal umieszczasz kość. Pełną listę znajdziesz w <b>JAK GRAĆ → RUNY</b>.',
    },
    twoPlayers: {
      heading: 'Dwoje graczy',
      body: 'Wybierz <b>2 GRACZY</b>, aby grać na jednym telefonie, a następnie określ ułożenie. <b>Przekazywanie</b>: między turami pojawia się ekran przekazania, a plansze zamieniają się miejscami, aby aktywny gracz był na dole. <b>Naprzeciwko</b>: połóż telefon płasko między sobą — górna połowa jest obrócona dla Gracza 2, tury zmieniają się automatycznie, a jasna połowa z obracającą się kością pośrodku wskazuje kolej gracza.',
    },
  },
  library: {
    gameModes: 'TRYBY GRY',
    runes: 'RUNY',
    openMode: 'Otwórz zasady: {{name}}',
    openRune: 'Otwórz szczegóły: {{name}}',
  },
  firstRun: {
    title: 'Pierwszy raz?',
    body: 'Samouczek to jedna gra z przewodnikiem — pięć lekcji do rozegrania zamiast czytania. Trwa około minuty i pojawi się tylko raz.',
    play: 'Zagraj w samouczek',
    startTutorial: 'Rozpocznij samouczek',
    skip: 'Pomiń, znam zasady',
  },
} satisfies CatalogShape<typeof enLearn>;
