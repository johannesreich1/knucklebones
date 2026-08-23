// Small browser-suite primitives shared without imposing a page-object layer.
export function createBrowserReport() {
  const problems = [];
  const out = {};
  const check = (condition, message, detail) => {
    if (!condition) problems.push(message + ' :: ' + JSON.stringify(detail));
  };
  return { problems, out, check };
}

export function capturePageErrors(page, problems, label = '') {
  page.on('pageerror', (error) => {
    problems.push(`PAGEERROR${label ? `(${label})` : ''}: ${error.message}`);
  });
}
