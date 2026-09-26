import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, cp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { applyReadingPatch } from '../extensions/space-browsa/reading-patch.mjs';
import { applyAttachmentsPatch } from '../extensions/space-browsa/attachments-patch.mjs';
import { applyNetworkPatch } from '../extensions/space-browsa/network-patch.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recipe = join(root, 'extensions/space-browsa');
const upstream = JSON.parse(await readFile(join(recipe, 'upstream.json'), 'utf8'));
const identity = JSON.parse(await readFile(join(recipe, 'identity.json'), 'utf8'));
async function recipeFiles(dir, prefix = '') {
  const output = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(output, await recipeFiles(join(dir, entry.name), path + '/'));
    else if (entry.isFile()) output[path] = createHash('sha256').update(await readFile(join(dir, entry.name))).digest('hex');
  }
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
const recipeHashes = await recipeFiles(recipe);
const originInput = process.env.STORE_ORIGIN || 'http://localhost:5173';
const url = new URL(originInput);
if (url.origin !== originInput || url.username || url.password ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
  throw new Error('STORE_ORIGIN must be an exact HTTPS origin (or HTTP localhost).');
}
const version = process.env.SPACE_BROWSA_VERSION || upstream.version;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.split('.').some(n => +n > 65535) || version === '0.0.0') {
  throw new Error('Invalid SPACE_BROWSA_VERSION');
}
const cache = join(root, '.data/browsa-upstream');
const output = join(root, '.data/packages', `space-browsa-${version}`);
const command = (bin, args, cwd = root) => execFileSync(bin, args, { cwd, stdio: 'inherit' });
await mkdir(join(root, '.data'), { recursive: true });
if (!existsSync(join(cache, '.git'))) {
  command('git', ['init', cache]);
  command('git', ['fetch', '--depth=1', upstream.repository, upstream.commit], cache);
}
// Archive the pinned commit, never the cache's working tree or local modifications.
const archive = execFileSync('git', ['archive', upstream.commit], { cwd: cache, maxBuffer: 128 * 1024 * 1024 });
const work = await mkdtemp(join(root, '.data/browsa-build-'));
try {
  execFileSync('tar', ['-xf', '-', '-C', work], { input: archive });
  await applyReadingPatch(work);
  await applyAttachmentsPatch(work);
  await applyNetworkPatch(work);
  for (const file of ['package.json', 'package-lock.json']) await cp(join(recipe, file), join(work, file));
  const npmCommand = process.env.npm_execpath
    ? args => command(process.execPath, [process.env.npm_execpath, ...args], work)
    : args => command('npm', args, work);
  npmCommand(['ci', '--ignore-scripts', '--no-fund']);
  npmCommand(['audit', '--audit-level=moderate']);
  // Upstream checks in vendor bundles. Rebuild npm-backed bundles from our lock;
  // unchanged extraction/Markdown bundles remain pinned to the upstream commit.
  command(process.execPath, ['build/build.mjs'], work);
  const { build } = await import(pathToFileURL(join(work, 'node_modules/esbuild/lib/main.js')).href);
  await build({ entryPoints: [join(work, 'node_modules/dompurify/dist/purify.cjs.js')],
    bundle: true, format: 'esm', target: 'es2020', minify: true, platform: 'browser',
    outfile: join(work, 'lib/vendor/purify.bundle.js') });
  command(process.execPath, ['--test', '--test-concurrency=2',
    'test/llm-client-chat-reasoning.test.mjs', 'test/llm-client-responses.test.mjs',
    'test/options-provider-ping.test.mjs', 'test/lib-provider-multi-model.test.mjs'], work);
  const manifest = JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8'));
  Object.assign(manifest, { name: upstream.name, short_name: 'SPACE AI', version,
    description: 'AI sidebar with custom OpenAI-compatible models. Based on browsa; distributed through SPACE.',
    key: identity.key, homepage_url: 'https://github.com/materialofair/mychromeStore',
    externally_connectable: { matches: [`${url.origin}/*`] } });
  manifest.action.default_title = 'Open SPACE AI sidebar';
  await writeFile(join(work, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const background = await readFile(join(work, 'background.js'), 'utf8');
  await writeFile(join(work, 'background.js'), "import './space-store-bridge.js';\n" + background);
  const bridge = (await readFile(join(recipe, 'store-bridge.js'), 'utf8')).replace('__SPACE_STORE_ORIGIN__', JSON.stringify(url.origin));
  await writeFile(join(work, 'space-store-bridge.js'), bridge);
  // Explicit runtime allowlist excludes upstream local notes, tests and build data.
  const roots = ['background.js', 'space-store-bridge.js', 'manifest.json', 'sidepanel.html',
    'sidepanel.js', 'sidepanel.css', 'options.html', 'options.js', 'options.css', 'lib', 'icons', 'fonts', '_locales', 'LICENSE'];
  const files = Object.create(null);
  async function collect(path) {
    const entries = await readdir(join(work, path), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (entry.name === '_src') continue;
      const relative = `${path}/${entry.name}`;
      if (entry.isDirectory()) await collect(relative);
      else if (entry.isFile()) files[relative] = await readFile(join(work, relative));
      else throw new Error(`Unexpected runtime entry: ${relative}`);
    }
  }
  for (const path of roots) {
    if (['lib', 'icons', 'fonts', '_locales'].includes(path)) await collect(path);
    else files[path] = await readFile(join(work, path));
  }
  // Include dependency notices alongside upstream MIT attribution.
  async function licenses(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const child = join(dir, entry.name);
      if (entry.name.startsWith('@')) { await licenses(child, `${prefix}${entry.name}/`); continue; }
      for (const name of await readdir(child)) {
        if (/^(licen[cs]e|notice)(\.|$)/i.test(name)) {
          const key = `licenses/${prefix.replaceAll('@', '')}${entry.name}/${name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
          const bytes = await readFile(join(child, name)).catch(() => null);
          if (bytes) files[key] = bytes;
        }
      }
      if (existsSync(join(child, 'node_modules'))) await licenses(join(child, 'node_modules'), `${prefix}${entry.name}/dependencies/`);
    }
  }
  await licenses(join(work, 'node_modules'));
  // Notices for pinned upstream vendor bundles and fonts (not npm build inputs).
  async function collectNotices(dir, prefix = 'notices') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name), relative = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await collectNotices(path, relative);
      else if (entry.isFile()) files[relative] = await readFile(path);
    }
  }
  await collectNotices(join(recipe, 'notices'));
  const notices = JSON.parse(files['notices/manifest.json'].toString());
  for (const artifact of notices.artifacts) {
    if (!files[artifact.packagedPath] || createHash('sha256').update(files[artifact.packagedPath]).digest('hex') !== artifact.sha256)
      throw new Error(`Pinned vendor has changed; recheck provenance and notices: ${artifact.packagedPath}`);
    for (const notice of artifact.noticePaths) if (!files[`notices/${notice}`]?.length)
      throw new Error(`Missing required notice: ${notice}`);
  }
  const references = JSON.parse(files['notices/license-references.json'].toString());
  for (const reference of references.references) for (const notice of reference.noticeFiles) {
    if (!files[`notices/${notice.path}`] || createHash('sha256').update(files[`notices/${notice.path}`]).digest('hex') !== notice.sha256)
      throw new Error(`Missing or changed license reference: ${notice.path}`);
  }
  files['SPACE-LICENSE'] = await readFile(join(root, 'LICENSE'));
  files['SPACE-PROVENANCE.json'] = Buffer.from(JSON.stringify({ ...upstream, version, extensionId: identity.extensionId, storeOrigin: url.origin,
    recipeHashes,
    lockSha256: createHash('sha256').update(await readFile(join(recipe, 'package-lock.json'))).digest('hex') }, null, 2));
  // An existing output may be loaded in a browser. Never overwrite it silently.
  if (existsSync(output) || existsSync(output + '.zip')) throw new Error(`Output already exists: ${output}. Move it or choose a new version.`);
  await mkdir(output, { recursive: true });
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(output, path)), { recursive: true });
    await writeFile(join(output, path), bytes);
  }
  const entries = Object.fromEntries(Object.keys(files).sort().map(path => [path, [files[path], { mtime: new Date(2026, 0, 1, 0, 0, 0) }]]));
  const zip = zipSync(entries, { level: 6 });
  await writeFile(output + '.zip', zip);
  console.log(JSON.stringify({ output, zip: output + '.zip', extensionId: identity.extensionId, version,
    files: Object.keys(files).length, zipBytes: zip.length, sha256: createHash('sha256').update(zip).digest('hex') }, null, 2));
} finally {
  await rm(work, { recursive: true, force: true });
}
