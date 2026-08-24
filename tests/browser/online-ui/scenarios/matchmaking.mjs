export async function runMatchmakingScenarios(suite) {
  const { visit, out, check } = suite;
  const queued = await visit({ door: 'play' });
  const samples = queued.queueLabel ?? [];
  out.matchmakingLabel = samples;

  check(samples.length === 4 && samples.every((sample) =>
    sample.label === 'Looking for an opponent'),
  'the matchmaking wait no longer says the intended label', samples);
  check(samples.every((sample) => sample.labelAnimation === 'none'),
    'the matchmaking label is animating again', samples);
  check(samples.every((sample) => !sample.pseudoContent.includes('.')),
    'the matchmaking label is generating trailing dots again', samples);
  check(samples.every((sample) => sample.dieAnimation === 'qspin'),
    'removing the label animation also stopped the waiting dice', samples);
  check(queued.queueCancel?.label === 'Cancel'
    && queued.queueCancel.textTransform === 'uppercase'
    && queued.queueCancel.clipped === false,
  'the English matchmaking cancel action is not concise and fully visible', queued.queueCancel);
  check(queued.errs.length === 0, 'page errors on the matchmaking queue', queued.errs);

  const german = await visit({ door: 'play', locale: 'de-DE' });
  out.matchmakingGerman = { samples: german.queueLabel, lang: german.rootLang };
  check(german.rootLang === 'de' && german.queueLabel?.every((sample) =>
    sample.label === 'Gegner wird gesucht'),
  'the online queue did not follow the German browser language', out.matchmakingGerman);
  check(german.queueCancel?.label === 'Abbrechen'
    && german.queueCancel.textTransform === 'uppercase'
    && german.queueCancel.clipped === false,
  'the German matchmaking action should display only ABBRECHEN', german.queueCancel);
  check(german.errs.length === 0, 'page errors on the German matchmaking queue', german.errs);
}
