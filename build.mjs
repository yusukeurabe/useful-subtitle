import * as esbuild from 'esbuild';
import { cp, mkdir, rm, copyFile } from 'node:fs/promises';
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

/** Copy non-bundled assets (manifest, options HTML, icons) into dist/. */
async function copyStatic() {
  await copyFile(resolve(root, 'manifest.json'), resolve(outdir, 'manifest.json'));
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
