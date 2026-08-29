// The dependency-free contract between the reveal shell and its theatres.
// A theatre describes one beat; the shell owns sequencing, settling and any
// optional peer coordination.
export interface Answer {
  name: string;
  blurb: string;
  hue: string;
  icon: string;
  /** Optional owner/context retained when this answer settles above a later beat. */
  context?: string;
  contextHue?: string;
}

export interface Beat extends Answer {
  label: string;
  /* THIS ANSWER SPEAKS FOR ITSELF. The shell normally restates the earlier
     answers above a landed beat and prints its name and blurb below — worth it
     when the answer is a word ("SINGLE STRIKE") that needs its rule beside it.
     A beat whose stage already names both players and both runes is not that:
     the restated mode, the "revealed" line and the pair sentence are three
     more things to read for something already on screen. Owner call
     2026-08-29: title and cards, nothing else. */
  bare?: boolean;
  cls?: string;
  stage: string;
  /** Repaint locale-owned text already mounted inside the theatre. */
  repaintStage?(stage: HTMLElement): void;
  run(settle: () => void): Promise<void>;
}

export interface DialSide {
  name: string;
  rating?: number | null;
  avatar?: string | null;
}

export interface DialPeer {
  announce(): void;
  onPeer(cb: () => void): () => void;
}
