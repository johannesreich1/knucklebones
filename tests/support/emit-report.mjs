// PRINT THE SUITE'S REPORT WITHOUT LOSING THE END OF IT.
//
// A suite prints one JSON report and then forces its own exit, because a
// browser suite can be left holding a driver handle and the gate would rather
// not wait out SUITE_TIMEOUT_MS to find that out.
//
// Those two facts do not compose. Under the gate stdout is a PIPE, and writes
// to a pipe are ASYNCHRONOUS: process.exit() returns immediately and discards
// whatever the 64KB pipe buffer has not taken. Run the same suite by hand and
// stdout is a file or a terminal, where the write is synchronous and nothing is
// lost — so the truncation appears only under the gate, and only once a report
// grows past 64KB.
//
// It cost a release to find. tests/browser/online-ui/run.mjs crossed the buffer
// at 79,714 bytes; the gate captured exactly 65,536, could not parse the JSON,
// and reported the suite as FAILED with no failing check anywhere in it —
// `run-all.mjs` treats an unparseable report as red, which is correct of it.
//
// So drain first, then exit. Every suite that forces an exit should come
// through here rather than keep its own copy of that ordering.
export function emitReport(report, failed) {
  const code = failed ? 1 : 0;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, () => process.exit(code));
}
