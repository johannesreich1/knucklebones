// Ownership for one restartable asynchronous operation. A monotonic generation
// cannot be reset to an earlier "active" value, so an old await can never wake
// up inside a newer run and mistake that run's state for its own.
export interface RunGeneration {
  begin(): number;
  cancel(): void;
  owns(generation: number): boolean;
}

export function createRunGeneration(): RunGeneration {
  let current = 0;
  return {
    begin: () => ++current,
    cancel: () => { current++; },
    owns: (generation) => generation === current,
  };
}
