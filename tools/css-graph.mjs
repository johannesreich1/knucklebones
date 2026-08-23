// Resolve the app's CSS manifests for consumers that cannot rely on the
// browser/Vite to follow @import rules (the design-card builder and static
// ownership checks). The accepted grammar is intentionally small: imports
// are local .css files with no media/supports/layer qualifier. Expanding a
// qualified import as plain text would change its meaning, so fail instead.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

export class CssGraphError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CssGraphError';
  }
}

const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;
const quoted = (ch) => ch === '"' || ch === "'";

function skipComment(source, at, file) {
  const end = source.indexOf('*/', at + 2);
  if (end < 0) throw new CssGraphError(`${file}:${lineAt(source, at)}: unterminated CSS comment`);
  return end + 2;
}

function skipString(source, at, file) {
  const quote = source[at];
  for (let i = at + 1; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === quote) return i + 1;
  }
  throw new CssGraphError(`${file}:${lineAt(source, at)}: unterminated CSS string`);
}

/* Find only top-level imports. Text inside comments, strings and rule bodies
   is deliberately invisible, so a comment that documents `@import` cannot
   accidentally become a dependency. */
function findImports(source, file) {
  const found = [];
  let depth = 0;
  for (let i = 0; i < source.length;) {
    if (source.startsWith('/*', i)) { i = skipComment(source, i, file); continue; }
    if (quoted(source[i])) { i = skipString(source, i, file); continue; }
    if (source[i] === '{') { depth++; i++; continue; }
    if (source[i] === '}') { depth = Math.max(0, depth - 1); i++; continue; }
    if (depth || source.slice(i, i + 7).toLowerCase() !== '@import'
        || (!/\s/.test(source[i + 7] ?? '') && !source.startsWith('/*', i + 7))) {
      i++;
      continue;
    }

    const start = i;
    let parens = 0;
    i += 7;
    for (; i < source.length; i++) {
      if (source.startsWith('/*', i)) { i = skipComment(source, i, file) - 1; continue; }
      if (quoted(source[i])) { i = skipString(source, i, file) - 1; continue; }
      if (source[i] === '(') parens++;
      else if (source[i] === ')') parens--;
      else if (source[i] === ';' && parens === 0) break;
    }
    if (i >= source.length) {
      throw new CssGraphError(`${file}:${lineAt(source, start)}: @import is missing its semicolon`);
    }
    found.push({ start, end: i + 1, statement: source.slice(start, i + 1) });
    i++;
  }
  return found;
}

function importTarget({ statement, start }, source, file) {
  const body = statement.slice(7, -1);
  let at = 0;
  const skipTrivia = () => {
    for (;;) {
      while (/\s/.test(body[at] ?? '')) at++;
      if (!body.startsWith('/*', at)) return;
      const end = body.indexOf('*/', at + 2);
      if (end < 0) throw new CssGraphError(`${file}:${lineAt(source, start)}: unterminated @import comment`);
      at = end + 2;
    }
  };
  const readQuoted = () => {
    const quote = body[at++];
    const begin = at;
    for (; at < body.length; at++) {
      if (body[at] === '\\') {
        throw new CssGraphError(`${file}:${lineAt(source, start)}: escaped @import paths are unsupported`);
      }
      if (body[at] === quote) return body.slice(begin, at++);
    }
    throw new CssGraphError(`${file}:${lineAt(source, start)}: unterminated @import path`);
  };

  skipTrivia();
  let target;
  if (quoted(body[at])) {
    target = readQuoted();
  } else if (body.slice(at, at + 3).toLowerCase() === 'url') {
    at += 3;
    skipTrivia();
    if (body[at++] !== '(') {
      throw new CssGraphError(`${file}:${lineAt(source, start)}: malformed @import url()`);
    }
    skipTrivia();
    if (quoted(body[at])) target = readQuoted();
    else {
      const close = body.indexOf(')', at);
      if (close < 0) throw new CssGraphError(`${file}:${lineAt(source, start)}: malformed @import url()`);
      target = body.slice(at, close).trim();
      at = close;
    }
    skipTrivia();
    if (body[at++] !== ')') {
      throw new CssGraphError(`${file}:${lineAt(source, start)}: malformed @import url()`);
    }
  } else {
    throw new CssGraphError(`${file}:${lineAt(source, start)}: @import must use a quoted path or url()`);
  }
  skipTrivia();
  if (at !== body.length) {
    throw new CssGraphError(`${file}:${lineAt(source, start)}: qualified @imports are unsupported; import a local file without layer, supports, or media conditions`);
  }
  if (!target) throw new CssGraphError(`${file}:${lineAt(source, start)}: @import path is empty`);
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) {
    throw new CssGraphError(`${file}:${lineAt(source, start)}: remote @import is forbidden: ${target}`);
  }
  if (isAbsolute(target) || target.startsWith('~')) {
    throw new CssGraphError(`${file}:${lineAt(source, start)}: @import must be relative: ${target}`);
  }
  if (/[?#]/.test(target) || target.includes('\\')) {
    throw new CssGraphError(`${file}:${lineAt(source, start)}: @import path must be a plain local path: ${target}`);
  }
  if (extname(target).toLowerCase() !== '.css') {
    throw new CssGraphError(`${file}:${lineAt(source, start)}: @import must name a .css file: ${target}`);
  }
  return target;
}

/**
 * Inline one or more CSS entry files and return their complete dependency set.
 * With no imports, `css` is byte-for-byte the entry contents joined by the
 * supplied separator (a newline by default), preserving the old consumers.
 */
export function inlineCssGraph(entries, { rootDir = process.cwd(), separator = '\n' } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new CssGraphError('CSS graph needs at least one entry file');
  }

  const root = realpathSync(resolve(rootDir));
  const seen = new Map();
  const stack = [];
  const files = [];
  const display = (file) => relative(root, file).split(sep).join('/');
  const insideRoot = (file) => {
    const rel = relative(root, file);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  const canonical = (candidate, from) => {
    let file;
    try { file = realpathSync(candidate); }
    catch (error) {
      throw new CssGraphError(`${from}: cannot read CSS file ${relative(root, candidate)} (${error.code ?? error.message})`);
    }
    if (!insideRoot(file)) throw new CssGraphError(`${from}: CSS import escapes root ${root}`);
    if (extname(file).toLowerCase() !== '.css') throw new CssGraphError(`${from}: CSS graph file is not .css: ${display(file)}`);
    return file;
  };

  const visit = (candidate, from) => {
    const file = canonical(candidate, from);
    const active = stack.indexOf(file);
    if (active >= 0) {
      const cycle = [...stack.slice(active), file].map(display).join(' -> ');
      throw new CssGraphError(`CSS import cycle: ${cycle}`);
    }
    if (seen.has(file)) {
      throw new CssGraphError(`duplicate CSS inclusion: ${display(file)} (first from ${seen.get(file)}, again from ${from})`);
    }

    seen.set(file, from);
    files.push(file);
    stack.push(file);
    const source = readFileSync(file, 'utf8');
    let css = '';
    let cursor = 0;
    for (const found of findImports(source, display(file))) {
      const target = importTarget(found, source, display(file));
      css += source.slice(cursor, found.start);
      css += visit(resolve(dirname(file), target), `${display(file)}:${lineAt(source, found.start)}`);
      cursor = found.end;
    }
    css += source.slice(cursor);
    stack.pop();
    return css;
  };

  const css = entries.map((entry) => {
    const candidate = isAbsolute(entry) ? entry : resolve(root, entry);
    return visit(candidate, '<entry>');
  }).join(separator);
  return { css, files };
}
