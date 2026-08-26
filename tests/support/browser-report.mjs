// Small browser-suite primitives shared without imposing a page-object layer.
// `maxDetailChars` clips one oversized failure detail (a full DOM/geometry
// dump) so a single check cannot flood the parent gate's buffered report.
export function createBrowserReport(options = {}) {
  const { maxDetailChars = Infinity } = options;
  const problems = [];
  const errs = [];
  const out = {};
  const check = (condition, message, detail) => {
    if (condition) return;
    const encoded = JSON.stringify(detail);
    const clipped = typeof encoded === 'string' && encoded.length > maxDetailChars
      ? `${encoded.slice(0, maxDetailChars)}…` : encoded;
    problems.push(`${message} :: ${clipped}`);
  };
  return { problems, errs, out, check };
}

// Route captured page failures into the given sink (`problems` fails the
// suite outright; a tree that reports `errs` separately passes that array).
// `console: true` additionally captures console.error output.
export function capturePageErrors(page, problems, label = '', options = {}) {
  const tag = label ? `(${label})` : '';
  page.on('pageerror', (error) => {
    problems.push(`PAGEERROR${tag}: ${error.message}`);
  });
  if (options.console) {
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`CONSOLE${tag}: ${message.text()}`);
    });
  }
}
