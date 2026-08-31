export interface LadderRingLayersOptions {
  /** Full-size league material: the outer halo and inner orbit. */
  readonly material?: boolean;
  /** Current-season high-water mark used by Profile. */
  readonly peak?: boolean;
  /** Previous league material used only while a transition sheds its old ring. */
  readonly previousMaterial?: boolean;
}

/**
 * Canonical decorative anatomy for every ladder ring. Interactive content is
 * deliberately a caller-owned slot: Profile seats buttons and labels in the
 * ring, while a transition seats a passive avatar and its one-shot particles.
 */
export function ladderRingLayersMarkup(
  options: LadderRingLayersOptions = {},
): string {
  const layers = ['<i class="lring"></i>'];
  if (options.material) layers.push('<i class="lhalo"></i>');
  if (options.previousMaterial) layers.push('<i class="loldarc"></i>');
  if (options.material) layers.push('<i class="lorbit"></i>');
  if (options.peak) layers.push('<i class="lpeak"></i>');
  return layers.join('');
}
