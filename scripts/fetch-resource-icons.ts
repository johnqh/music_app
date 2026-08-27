/**
 * Downloads each Resources link's site icon into `public/resource-icons/`.
 *
 * Run with `bun run scripts/fetch-resource-icons.ts`. It is a curation step,
 * not part of the build: the icons are committed, so the page has no build-time
 * network dependency and no runtime one either.
 *
 * The page does **not** hotlink these. Forty-two `<img>` tags pointing at forty-two
 * other people's servers would tell each of them who is reading our Resources
 * page, and would leave the page speckled with broken images the first time one
 * of those sites reorganised. Vendoring makes the icons ours to serve, one
 * origin, cached like any other asset.
 *
 * Best-resolution-first, since the tile draws at 2x on a retina screen:
 *   1. `apple-touch-icon` — a PNG, almost always 152-180px, and the one icon
 *      site owners actually art-direct.
 *   2. `<link rel="icon">` with an explicit `sizes`, largest wins.
 *   3. The web app manifest's icon list, largest wins.
 *   4. `/favicon.ico`.
 *   5. Google's favicon service at 128px — the fallback that matters, because
 *      several of these sites sit behind bot protection that answers a script
 *      with 403 no matter what it claims to be.
 *
 * SVG is kept as-is (it is resolution-independent); everything else is
 * converted to PNG and capped at 128px, which is what keeps one 60KB
 * apple-touch-icon from outweighing the rest of the page. It is **capped, not
 * resized** — a site whose only icon is a 32px favicon.ico gets a 32px file.
 * Resampling that up to 128 costs six times the bytes to store the same
 * information, and the browser then scales a blurred copy instead of a crisp
 * original.
 *
 * Output lands in `src/assets/` rather than `public/` so the page can reach it
 * through `import.meta.glob`: what exists on disk *is* the lookup table, so a
 * site with no icon cannot be recorded as having one.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { RESOURCE_GROUPS } from '../src/pages/resource-links';

const OUT = resolve(import.meta.dir, '../src/assets/resource-icons');
const TMP = resolve(import.meta.dir, '../node_modules/.cache/resource-icons');
/** What the tile draws at, doubled for retina. */
const SIZE = 128;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

type Candidate = { url: string; size: number };

async function get(url: string, timeoutMs = 20_000): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
}

/** `"180x180"` / `"any"` / missing → a number we can sort on. */
function parseSizes(value: string | undefined): number {
  if (!value) return 0;
  if (/any/i.test(value)) return 1000; // an SVG, effectively unbounded
  const largest = [...value.matchAll(/(\d+)\s*[x×]\s*(\d+)/gi)].map((m) => Number(m[1]));
  return largest.length ? Math.max(...largest) : 0;
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
}

async function candidatesFor(pageUrl: string): Promise<Candidate[]> {
  const res = await get(pageUrl);
  if (!res?.ok) return [];
  const html = await res.text();
  const base = res.url || pageUrl;
  const found: Candidate[] = [];

  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attr(tag, 'rel')?.toLowerCase() ?? '';
    const href = attr(tag, 'href');
    if (!href) continue;
    const abs = new URL(href, base).href;

    if (rel.includes('apple-touch-icon')) {
      // Art-directed and reliably large; bias it above a same-size favicon.
      found.push({ url: abs, size: parseSizes(attr(tag, 'sizes')) || 180 });
    } else if (rel.split(/\s+/).includes('icon') || rel.includes('shortcut icon')) {
      found.push({
        url: abs,
        size: parseSizes(attr(tag, 'sizes')) || (/\.svg/i.test(abs) ? 1000 : 32),
      });
    } else if (rel.includes('manifest')) {
      const manifest = await get(abs);
      if (manifest?.ok) {
        try {
          const icons = (await manifest.json())?.icons ?? [];
          for (const icon of icons) {
            if (icon?.src) {
              found.push({ url: new URL(icon.src, abs).href, size: parseSizes(icon.sizes) });
            }
          }
        } catch {
          /* a manifest that is not JSON tells us nothing */
        }
      }
    }
  }
  return found;
}

/** Bytes that are actually an image, or null. */
async function download(url: string): Promise<{ body: Uint8Array; type: string } | null> {
  const res = await get(url);
  if (!res?.ok) return null;
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength < 64) return null; // a 1px tracker or an error page
  const type = res.headers.get('content-type') ?? '';
  if (/text\/html/i.test(type)) return null; // a soft 404
  return { body, type };
}

function extensionFor(url: string, type: string): string {
  if (/svg/i.test(type) || /\.svg(\?|$)/i.test(url)) return 'svg';
  if (/png/i.test(type) || /\.png(\?|$)/i.test(url)) return 'png';
  if (/jpe?g/i.test(type) || /\.jpe?g(\?|$)/i.test(url)) return 'jpg';
  if (/webp/i.test(type) || /\.webp(\?|$)/i.test(url)) return 'webp';
  return 'ico';
}

/** The source's own longest edge, or 0 when sips cannot read it. */
function longestEdge(file: string): number {
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
      encoding: 'utf8',
    });
    const dims = [...out.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map((m) => Number(m[1]));
    return dims.length ? Math.max(...dims) : 0;
  } catch {
    return 0;
  }
}

/**
 * Converts to PNG and caps the longest edge at `SIZE`, leaving SVG alone.
 *
 * Never upscales: `sips -Z` resamples in both directions, so a 32px favicon
 * would come back as a 128px blur six times the size on disk.
 *
 * `sips` reads .ico on macOS but reports success while writing nothing when the
 * file is a container it cannot decode, so the output is checked rather than
 * the exit code.
 */
function normalise(input: string, output: string): boolean {
  if (input.endsWith('.svg')) {
    writeFileSync(output, readFileSync(input));
    return true;
  }
  const edge = longestEdge(input);
  if (edge === 0) return false;
  const args = ['-s', 'format', 'png'];
  if (edge > SIZE) args.push('-Z', String(SIZE));
  try {
    execFileSync('sips', [...args, input, '--out', output], { stdio: 'ignore' });
  } catch {
    return false;
  }
  return existsSync(output);
}

const links = RESOURCE_GROUPS.flatMap((group) => group.links);

mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

let ok = 0;
const failures: string[] = [];

for (const link of links) {
  const host = new URL(link.url).host;
  const tried = await candidatesFor(link.url);
  // Largest first, then the site's own /favicon.ico, then the service that
  // answers for the sites which refuse a script outright.
  const ordered: Candidate[] = [
    ...tried.sort((a, b) => b.size - a.size),
    { url: new URL('/favicon.ico', link.url).href, size: 0 },
    { url: `https://www.google.com/s2/favicons?sz=${SIZE}&domain=${host}`, size: 0 },
  ];

  let done = false;
  for (const candidate of ordered) {
    const got = await download(candidate.url);
    if (!got) continue;
    const ext = extensionFor(candidate.url, got.type);
    const raw = join(TMP, `${link.key}.${ext}`);
    writeFileSync(raw, got.body);
    const out = join(OUT, `${link.key}.${ext === 'svg' ? 'svg' : 'png'}`);
    if (!normalise(raw, out)) continue;
    console.log(
      `${link.key.padEnd(20)} ${String(candidate.size || '?').padStart(4)}px  ${candidate.url}`,
    );
    ok += 1;
    done = true;
    break;
  }
  if (!done) failures.push(`${link.key} (${host})`);
}

console.log(`\n${ok}/${links.length} icons written to src/assets/resource-icons`);
if (failures.length) console.log(`no icon found for: ${failures.join(', ')}`);
