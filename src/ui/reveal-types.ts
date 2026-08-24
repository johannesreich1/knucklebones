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
