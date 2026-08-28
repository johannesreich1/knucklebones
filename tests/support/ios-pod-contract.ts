import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

type Check = (ok: boolean, message: string) => void;

const PODFILE = 'native/ios/App/Podfile';
const LOCK = 'native/ios/App/Podfile.lock';
const PKG = 'native/package.json';
const GC_POD = 'KnucklebonesGameCenter';

/** What the Podfile and its lock parsed into. Returned rather than kept
    module-private so the anchors below can prove those parsers still bite,
    against the very collections every assertion here iterated. */
export type PodManifests = {
  podfileSha: string;
  stamped: string | null;
  declared: Map<string, string>;
  locked: Map<string, string>;
  checksums: Set<string>;
};

/* Was Podfile.lock generated from THIS Podfile, and do the Podfile, the lock
   and native/package.json still describe the same set of pods? Pure text, so
   it needs no CocoaPods, no native/node_modules and no Mac. The suite that
   calls this carries the history that made the question worth asking. */
export function verifyIosPodContract(check: Check): PodManifests {
  const podfile = readFileSync(PODFILE, 'utf8');
  const lock = readFileSync(LOCK, 'utf8');
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'));

  /* the exact question, in one comparison: was this lock generated from this Podfile? */
  const stamped = (lock.match(/^PODFILE CHECKSUM: (\w+)$/m) || [])[1] ?? null;
  const podfileSha = createHash('sha1').update(podfile).digest('hex');
  check(stamped === podfileSha,
    `${LOCK} carries PODFILE CHECKSUM ${stamped}, but ${PODFILE} hashes to ${podfileSha}. `
    + `The lock was generated from a DIFFERENT Podfile than the one committed — run `
    + `\`pod install\` in native/ios/App and commit the result.`);

  // `pod 'CapawesomeCapacitorAppleSignIn', :path => '../../node_modules/@capawesome/capacitor-apple-sign-in'`
  const declared = new Map<string, string>();
  for (const m of podfile.matchAll(/^\s*pod\s+'([^']+)'\s*,\s*:path\s*=>\s*'([^']+)'/gm)) {
    declared.set(m[1], m[2]);
  }

  // EXTERNAL SOURCES maps each locked pod back to the path it was built from.
  const externalBlock = (lock.match(/^EXTERNAL SOURCES:\n((?:[ \t].*\n?)*)/m) || [])[1] ?? '';
  const locked = new Map<string, string>();
  let currentPod: string | null = null;
  for (const line of externalBlock.split('\n')) {
    const head = line.match(/^ {2}(\S+):\s*$/);
    if (head) { currentPod = head[1]; continue; }
    const p = line.match(/^ {4}:path:\s*"?([^"\n]+?)"?\s*$/);
    if (p && currentPod) locked.set(currentPod, p[1]);
  }

  const checksums = new Set<string>();
  const sumBlock = (lock.match(/^SPEC CHECKSUMS:\n((?:[ \t].*\n?)*)/m) || [])[1] ?? '';
  for (const m of sumBlock.matchAll(/^ {2}(\S+):/gm)) checksums.add(m[1]);

  check(declared.get(GC_POD) === '../../plugins/gamecenter',
    `${PODFILE} must declare ${GC_POD} from the tracked ../../plugins/gamecenter package`);
  check(declared.get('CapawesomeCapacitorAppleSignIn') === '../../node_modules/@capawesome/capacitor-apple-sign-in',
    `${PODFILE} must declare the Capawesome Apple Sign-In pod from its installed package`);
  check(declared.get('CapacitorSplashScreen') === '../../node_modules/@capacitor/splash-screen',
    `${PODFILE} must declare CapacitorSplashScreen from its installed package`);
  check(!declared.has('CapacitorCommunityAppleSignIn'),
    `${PODFILE} must not retain the replaced iOS-only community Apple Sign-In pod`);
  check(locked.get(GC_POD) === '../../plugins/gamecenter',
    `${LOCK} must lock ${GC_POD} to the tracked ../../plugins/gamecenter package`);
  check(checksums.has(GC_POD),
    `${LOCK} has no SPEC CHECKSUM for the tracked ${GC_POD} bridge`);

  for (const [pod, path] of declared) {
    check(locked.has(pod),
      `the Podfile declares pod '${pod}' but ${LOCK} has no EXTERNAL SOURCES entry for it — `
      + `the lock predates that pod; run \`pod install\` and commit`);
    if (locked.has(pod)) {
      check(locked.get(pod) === path,
        `pod '${pod}' is declared at ${path} but locked at ${locked.get(pod)}`);
    }
    check(checksums.has(pod),
      `pod '${pod}' has no SPEC CHECKSUM in ${LOCK} — the lock is internally incoherent`);
  }
  for (const pod of locked.keys()) {
    check(declared.has(pod),
      `${LOCK} locks pod '${pod}' that no longer appears in the Podfile — a plugin was `
      + `removed without re-running \`pod install\``);
  }

  /* a locked path must name a package native/package.json installs. The paths point
     into native/node_modules, gitignored and absent on a fresh checkout, so resolve
     the CLAIM rather than the directory — this stays a pure-Node gate. */
  const deps: Record<string, string> = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const [pod, path] of locked) {
    const pkgName = (path.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/) || [])[1];
    if (!pkgName) continue;   // a pod from some source other than node_modules
    check(pkgName in deps,
      `pod '${pod}' builds from ${pkgName}, which ${PKG} does not declare — `
      + `\`mise exec -- npm --prefix native install\` would not produce it`);
  }

  return { podfileSha, stamped, declared, locked, checksums };
}

/* THE CHECK MUST BE ABLE TO FAIL. Every pod assertion loops over a parsed
   collection, so a regex that quietly stops matching turns this suite green by
   iterating nothing — the same vacuous pass that let the lock rot unnoticed.
   Anchor on both Capacitor pods plus the required local Game Center pod. */
export function verifyPodParsersCouldFail(check: Check, pods: PodManifests): void {
  const { declared, locked, stamped, checksums } = pods;
  for (const pod of ['Capacitor', 'CapacitorCordova', GC_POD]) {
    check(declared.has(pod), `the Podfile parser found no pod '${pod}' — the parser is broken, not the Podfile`);
    check(locked.has(pod), `the EXTERNAL SOURCES parser found no '${pod}' — the parser is broken, not the lock`);
  }
  check(stamped !== null, `no PODFILE CHECKSUM line in ${LOCK} — truncated, or the format changed`);
  check(checksums.size > 0, 'the SPEC CHECKSUMS parser found nothing — the parser is broken');
}
