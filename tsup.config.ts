import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    // Powers the "Try it" box on the GitHub Pages site.
    entry: { claimcheck: 'src/browser.ts' },
    outDir: 'docs',
    format: ['iife'],
    globalName: 'ClaimCheck',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    outExtension: () => ({ js: '.js' }),
  },
]);
