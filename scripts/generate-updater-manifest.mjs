import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = process.env.MARKDOWN233_VERSION || packageJson.version;
const repo = process.env.GITHUB_REPOSITORY || 'neko233-com/markdown233';
const tag = process.env.GITHUB_REF_NAME || `v${version}`;
const bundleDir = process.env.MARKDOWN233_BUNDLE_DIR || 'src-tauri/target/release/bundle';
const outFile = process.env.MARKDOWN233_MANIFEST_OUT || 'release/latest.json';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function platformFor(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.sig')) return null;
  if (lower.includes('nsis.zip')) return 'windows-x86_64';
  if (lower.endsWith('.exe') || lower.includes('nsis')) return 'windows-x86_64';
  if (lower.includes('aarch64') && (lower.endsWith('.dmg') || lower.endsWith('.app.tar.gz'))) return 'darwin-aarch64';
  if (lower.endsWith('.dmg') || lower.endsWith('.app.tar.gz')) return 'darwin-x86_64';
  return null;
}

const files = await walk(bundleDir);
const platforms = {};

for (const file of files) {
  const platform = platformFor(file);
  if (!platform) continue;
  const info = await stat(file);
  const name = basename(file);
  const signature = await readFile(`${file}.sig`, 'utf8').catch(async () => {
    const siblingSig = files.find((candidate) => candidate === `${file}.sig` || basename(candidate) === `${name}.sig`);
    return siblingSig ? readFile(siblingSig, 'utf8') : null;
  });
  platforms[platform] = {
    signature: (signature || process.env[`MARKDOWN233_SIGNATURE_${platform.replace(/-/g, '_').toUpperCase()}`] || 'UNSIGNED').trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
    size: info.size,
  };
}

const manifest = {
  version,
  notes: `Markdown233 ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

await writeFile(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updater manifest written to ${outFile}`);
