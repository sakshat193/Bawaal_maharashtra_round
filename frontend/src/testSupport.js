// Compile JSX for Node tests while sharing React with the test renderer.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function loadComponent(relativePath, env = {}) {
  const entry = new URL(relativePath, import.meta.url);
  const output = new URL(`../node_modules/.cache/fairdrop-tests/${entry.pathname.split('/').at(-1)}-${process.pid}.mjs`, import.meta.url);
  const result = await build({ entryPoints: [fileURLToPath(entry)], bundle: true, write: false,
    platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
    define: { 'import.meta.env': JSON.stringify({ VITE_MSW: '1', BASE_URL: '/', ...env }) } });
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, result.outputFiles[0].text);
  return import(output.href);
}
