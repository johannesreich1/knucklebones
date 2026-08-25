import { readFileSync } from 'node:fs';
import { nodeJobsUsePinnedNode } from './ci-workflow.ts';

type Check = (ok: boolean, message: string) => void;

const ROOT_PKG = 'package.json';
const ROOT_LOCK = 'package-lock.json';
const NVMRC = '.nvmrc';
const MISE = 'mise.toml';
const CI = '.github/workflows/ci.yml';
const BUILD = 'build.mjs';
const RUN_ALL = 'tests/run-all.mjs';
const DESIGN_CARD_SUITE = 'tests/test23.mjs';

/* One contract owns the runtime from repository pin through the deepest gate
   child. Keeping this out of the iOS manifest assertions also prevents native
   delivery checks from becoming the accidental owner of the release runner. */
export function verifyNodeRuntimeContract(check: Check): {
  nodePin: string;
  nodeRange: string;
} {
  const nodePin = readFileSync(NVMRC, 'utf8').trim();
  const nodeRange = '>=24 <25';
  const rootPkg = JSON.parse(readFileSync(ROOT_PKG, 'utf8'));
  const rootLock = JSON.parse(readFileSync(ROOT_LOCK, 'utf8'));

  check(nodePin === '24', `${NVMRC} pins ${JSON.stringify(nodePin)}, expected Node 24`);
  check(rootPkg.engines?.node === nodeRange,
    `${ROOT_PKG} engines.node=${JSON.stringify(rootPkg.engines?.node)}, expected ${nodeRange}`);
  check(rootPkg.devEngines?.runtime?.name === 'node'
    && rootPkg.devEngines.runtime.version === nodeRange
    && rootPkg.devEngines.runtime.onFail === 'error',
  ROOT_PKG + ' devEngines.runtime must fail npm commands outside ' + nodeRange);
  check(rootLock.packages?.['']?.engines?.node === nodeRange,
    `${ROOT_LOCK} does not mirror ${ROOT_PKG}'s Node engine ${nodeRange}`);

  check(Number(process.versions.node.split('.')[0]) === 24,
    'verification is running under Node ' + process.versions.node + ', expected the repository Node 24 pin');

  const mise = readFileSync(MISE, 'utf8');
  check(/^\s*idiomatic_version_file_enable_tools\s*=\s*\[\s*["']node["']\s*\]\s*$/m.test(mise)
    && /^\s*idiomatic_version_file_disable_files\s*=\s*\[\s*["']node:package\.json["']\s*\]\s*$/m.test(mise)
    && /^\s*zshrc\s*=\s*["']activate["']\s*$/m.test(mise)
    && !/^\s*node\s*=/m.test(mise),
  MISE + ' must activate Node from ' + NVMRC + ' rather than duplicate its version');

  const ci = readFileSync(CI, 'utf8');
  check(nodeJobsUsePinnedNode(ci),
    CI + ' must install Node from .nvmrc before every job first uses Node/npm/npx');

  const buildSource = readFileSync(BUILD, 'utf8');
  check(/process\.execPath/.test(buildSource),
    `${BUILD} must run TypeScript and Vite under the Node binary that launched it`);
  check(!/\bexecSync\s*\(/.test(buildSource) && !/\bcap(?:acitor)?\s+sync\b/.test(buildSource),
    `${BUILD} must remain deterministic and may not invoke an implicit Capacitor sync`);

  const releaseGateSource = readFileSync(RUN_ALL, 'utf8');
  const designCardSource = readFileSync(DESIGN_CARD_SUITE, 'utf8');
  check(/function\s+runNode\s*\([^)]*\)\s*\{[\s\S]*?spawn\(process\.execPath,/.test(releaseGateSource)
    && (releaseGateSource.match(/\brunNode\s*\(/g) ?? []).length >= 4
    && (releaseGateSource.match(
      /execFileSync\(process\.execPath,\s*\[['"]build\.mjs['"]/g) ?? []).length === 2,
  `${RUN_ALL} must propagate its validated Node executable through builds, suites, and benchmarks`);
  check(/execFileSync\(process\.execPath,\s*\[['"]design\/build\.mjs['"]/.test(designCardSource),
    `${DESIGN_CARD_SUITE} must build cards with the Node executable that launched the gate`);
  check(!/\b(?:spawn|execFileSync)\s*\(\s*['"]node['"]/.test(releaseGateSource + designCardSource)
    && !/\bexecSync\s*\(/.test(releaseGateSource + designCardSource),
  `${RUN_ALL} and ${DESIGN_CARD_SUITE} may not launch a bare Node from PATH`);

  return { nodePin, nodeRange };
}
