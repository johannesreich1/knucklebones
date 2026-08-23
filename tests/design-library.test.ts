import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DESIGN_CLASSIFICATIONS,
  discoverDesignScreens,
} from '../design/screen-library.mjs';

const problems: string[] = [];
const errs: string[] = [];
const fixture = mkdtempSync(path.join(tmpdir(), 'kb-design-library-'));
let repositoryCounts: Record<string, number> = {};
const writeCard = (relative: string) => {
  const file = path.join(fixture, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '<!-- meta name="fixture" -->\n');
};
const expectFailure = (label: string, pattern: RegExp) => {
  try {
    discoverDesignScreens(fixture);
    problems.push(`${label}: discovery unexpectedly succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) problems.push(`${label}: unexpected error: ${message}`);
  }
};

try {
  const repositoryScreens = discoverDesignScreens(path.join(process.cwd(), 'design', 'screens'));
  repositoryCounts = Object.fromEntries(DESIGN_CLASSIFICATIONS.map((classification) => [
    classification,
    repositoryScreens.filter((screen) => screen.classification === classification).length,
  ]));

  writeCard('product/deeper/40-product.html');
  writeCard('studies/open/20-open.html');
  writeCard('studies/archive/30-archive.html');
  const found = discoverDesignScreens(fixture);
  const order = found.map((screen) => screen.basename);
  const classifications = found.map((screen) => screen.classification);
  if (order.join(',') !== '20-open.html,30-archive.html,40-product.html') {
    problems.push(`basename order changed: ${order.join(',')}`);
  }
  if (classifications.join(',') !== 'studies/open,studies/archive,product') {
    problems.push(`classification mismatch: ${classifications.join(',')}`);
  }

  writeCard('99-unclassified.html');
  expectFailure('top-level card', /99-unclassified\.html: unclassified design card/);
  rmSync(path.join(fixture, '99-unclassified.html'));

  writeCard('studies/review/50-unclassified.html');
  expectFailure('unknown study state', /studies\/review\/50-unclassified\.html: unclassified design card/);
  rmSync(path.join(fixture, 'studies', 'review'), { recursive: true });

  writeCard('product/20-open.html');
  expectFailure('duplicate basename', /20-open\.html: duplicate design-card basename/);
} catch (error) {
  errs.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log(JSON.stringify({
  classifications: DESIGN_CLASSIFICATIONS,
  repositoryCounts,
  recursiveOrder: 'basename',
  topLevelCardsRejected: !problems.some((problem) => problem.startsWith('top-level card:')),
  duplicateBasenamesRejected: !problems.some((problem) => problem.startsWith('duplicate basename:')),
  problems,
  errs,
}, null, 2));
