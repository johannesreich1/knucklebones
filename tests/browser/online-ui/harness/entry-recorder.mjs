/* RECORD THE CHANGE, DO NOT SAMPLE FOR IT.
   This watched the online entry on requestAnimationFrame, which cannot see a
   state shorter than the gap between two paints — and a headless Linux runner
   with no GPU paints rarely. The whole loading phase is a few tens of ms of
   work, so on the hosted runner it happened BETWEEN two frames: the recorder
   reported one frame that already showed onAccount, and the account-
   replacement boundary read as "Profile painted account A" when Profile had
   done nothing wrong (hosted CI, 2026-09-03; locally the same entry yields
   four frames, the first of them onLoading).
   Panel visibility is the `hidden` attribute and the overlay's class, so every
   transition IS a mutation: observing them sees the true sequence at any paint
   cadence. Consecutive identical states are collapsed, so `frames` counts
   states the player passed through rather than unrelated class writes. */
export function installEntryRecorder(page) {
  return page.evaluate(() => {
        /* RECORD THE CHANGE, DO NOT SAMPLE FOR IT. This watched the entry on
           requestAnimationFrame, which cannot see a state that is shorter than
           the gap between two paints — and a headless Linux runner with no GPU
           paints rarely. The whole loading phase is a few tens of ms of work,
           so on the hosted runner it happened BETWEEN two frames: the recorder
           reported one frame that already showed onAccount, and the
           account-replacement boundary read as "Profile painted account A"
           when Profile had done nothing wrong (hosted CI, 2026-09-03; locally
           the same entry yields four frames, the first of them onLoading).
           Panel visibility is the `hidden` attribute and the overlay's class,
           so every transition IS a mutation: observing them sees the true
           sequence at any paint cadence. Consecutive identical states are
           collapsed, so `frames` stays a count of states the player passed
           through rather than of unrelated class writes elsewhere. */
        window.__onlineEntry = { frames: 0, emptyFrames: 0, first: null };
        const root = document.getElementById('kbroot') ?? document.body;
        let last = null;
        let done = false;
        const record = () => {
          if (done) return;
          const overlay = document.getElementById('ovOnline');
          if (!overlay?.classList.contains('on')) return;
          const visiblePanels = [...overlay.querySelectorAll('.panel')]
            .filter((panel) => !panel.hidden)
            .map((panel) => panel.id);
          const key = visiblePanels.join();
          if (key === last) return;
          last = key;
          window.__onlineEntry.frames++;
          if (!visiblePanels.length) window.__onlineEntry.emptyFrames++;
          window.__onlineEntry.first ??= {
            title: document.getElementById('onTitle')?.textContent ?? '',
            visiblePanels,
          };
          if (visiblePanels.some((id) => id !== 'onLoading')) done = true;
        };
        new MutationObserver(record).observe(root, {
          subtree: true, attributes: true, attributeFilter: ['class', 'hidden'],
        });
        record();
  });
}
