/* Pull the twelve candidate faces for the font study.
 *
 * Two things come down per family: the OFL text (which is also the proof that
 * we may ship it), and a TEXT-SUBSET woff2 per weight the cards use. The
 * subsets exist so a design card can carry its own face as a data URI without
 * blowing past DesignSync's per-card ceiling; they are preview material, not
 * the file a shipped bundle would use. */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
/* every glyph the study cards paint, plus the accents that decide whether a
   face can carry pl/tr/pt at all */
const TEXT = 'KNUCKLEBONESabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ·#,.:;!?—–-·’\'"()/+×%&@'
  + 'ŁłóŚśŻżĄąĘęĆćŃńÖöÜüÄäßÇçĞğİıŞşÃãÕõÁáÉéÍíÓóÚúÑñÀàÈèÙùÊêÔôÎîÛû';

const FAMILIES = [
  { family: 'Outfit',            slug: 'outfit',          weights: [400, 800, 900] },
  { family: 'Urbanist',          slug: 'urbanist',        weights: [400, 800, 900] },
  { family: 'Sora',              slug: 'sora',            weights: [400, 800, 800] },
  { family: 'Plus Jakarta Sans', slug: 'plusjakartasans', weights: [400, 800, 800] },
  { family: 'Nunito',            slug: 'nunito',          weights: [400, 800, 900] },
  { family: 'Manrope',           slug: 'manrope',         weights: [400, 800, 800] },
  { family: 'Archivo',           slug: 'archivo',         weights: [400, 800, 900] },
  { family: 'Space Grotesk',     slug: 'spacegrotesk',    weights: [400, 700, 700] },
  { family: 'Chakra Petch',      slug: 'chakrapetch',     weights: [400, 700, 700] },
  { family: 'Rajdhani',          slug: 'rajdhani',        weights: [400, 700, 700] },
  { family: 'Exo 2',             slug: 'exo2',            weights: [400, 800, 900] },
  { family: 'Saira',             slug: 'saira',           weights: [400, 800, 900] },
];

const get = async (url, kind) => {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${kind} ${res.status} ${url}`);
  return kind === 'bin' ? Buffer.from(await res.arrayBuffer()) : res.text();
};

const report = [];
for (const f of FAMILIES) {
  const dir = join('design', 'fonts', f.slug);
  mkdirSync(dir, { recursive: true });
  const ofl = await get(`https://raw.githubusercontent.com/google/fonts/main/ofl/${f.slug}/OFL.txt`, 'text');
  writeFileSync(join(dir, 'OFL.txt'), ofl);
  const line = { family: f.family, slug: f.slug, license: /SIL OPEN FONT LICENSE Version 1\.1/i.test(ofl) ? 'OFL-1.1' : 'UNKNOWN', files: {} };
  for (const w of [...new Set(f.weights)]) {
    const css = await get(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family)}:wght@${w}`
      + `&text=${encodeURIComponent(TEXT)}`, 'text');
    const url = css.match(/url\((https:[^)]+)\)\s*format\('woff2'\)/)?.[1];
    if (!url) throw new Error('no woff2 in css for ' + f.family + ' ' + w + '\n' + css.slice(0, 400));
    const bin = await get(url, 'bin');
    writeFileSync(join(dir, `${w}.woff2`), bin);
    line.files[w] = bin.length;
  }
  report.push(line);
  console.log(line.family.padEnd(19), line.license, Object.entries(line.files).map(([w, n]) => `${w}:${(n / 1024).toFixed(1)}KB`).join(' '));
}
writeFileSync(join('design', 'fonts', 'candidates.json'), JSON.stringify(report, null, 2) + '\n');
