import * as esbuild from 'esbuild';
import { cp, mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

/** esbuild entry points → dist/content.js, dist/background.js, dist/options.js */
const entryPoints = {
  content: resolve(root, 'src/content/index.ts'),
  background: resolve(root, 'src/background/index.ts'),
  options: resolve(root, 'src/options/options.ts'),
  offscreen: resolve(root, 'src/offscreen/index.ts'),
};

/** ビルド番号の保存先（Git 管理外）。dist/ はビルドのたびに消すので別に置く。 */
const buildNumberFile = resolve(root, '.build-number');
/** Chrome の version は 4 つの数字それぞれ 0〜65535 まで。 */
const MAX_VERSION_PART = 65535;

async function nextBuildNumber() {
  let current = 0;
  try {
    current = Number.parseInt(await readFile(buildNumberFile, 'utf8'), 10) || 0;
  } catch {
    // 初回は 0 から数える。
  }
  const next = current >= MAX_VERSION_PART ? 1 : current + 1;
  await writeFile(buildNumberFile, `${next}\n`);
  return next;
}

/**
 * manifest.json を dist/ へ書き出す。version の末尾にビルド番号を足し（0.1.0 → 0.1.0.7）、
 * 拡張機能の管理画面で ↻ を押したときに最新のビルドを読み込めたか番号で分かるようにする。
 * 元の manifest.json の version（PR ごとに上げる正式な番号）は書き換えない。
 */
async function writeManifest() {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const build = await nextBuildNumber();
  manifest.version = `${manifest.version}.${build}`;
  await writeFile(resolve(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[useful-subtitle] version ${manifest.version}`);
}

/** 成功したビルド（watch の再ビルドも含む）のたびに manifest を書き直す。 */
const stampVersionPlugin = {
  name: 'stamp-version',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) await writeManifest();
    });
  },
};

/** Copy non-bundled assets (options HTML, icons) into dist/. manifest は writeManifest が書く。 */
async function copyStatic() {
  await copyFile(
    resolve(root, 'src/options/options.html'),
    resolve(outdir, 'options.html'),
  );
  await copyFile(
    resolve(root, 'src/offscreen/offscreen.html'),
    resolve(outdir, 'offscreen.html'),
  );
  if (existsSync(resolve(root, 'icons'))) {
    await cp(resolve(root, 'icons'), resolve(outdir, 'icons'), { recursive: true });
  }
}

const buildOptions = {
  entryPoints,
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome114',
  sourcemap: true,
  logLevel: 'info',
  plugins: [stampVersionPlugin],
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  await copyStatic();
  console.log('[useful-subtitle] watching for changes…');
} else {
  await esbuild.build(buildOptions);
  await copyStatic();
  console.log('[useful-subtitle] build complete →', outdir);
}
