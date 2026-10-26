/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * The page's security policy, written once in public/_headers. Cloudflare Pages sends it as a
 * header; GitHub Pages sends no headers, so the build also puts it in the page as a meta tag
 * (build only: in dev it would block Vite's reload). A meta tag cannot carry frame-ancestors.
 */
function policyInPage(): Plugin {
  const line = readFileSync('public/_headers', 'utf-8').split(/\r?\n/).find((l) => l.trim().startsWith('Content-Security-Policy:'));
  const policy = (line ?? '').split(':').slice(1).join(':').split(';').map((p) => p.trim()).filter((p) => p && !p.startsWith('frame-ancestors')).join('; ');
  return {
    name: 'policy-in-page',
    apply: 'build',
    transformIndexHtml: () => (policy ? [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }] : []),
  };
}

/**
 * Anyone who opens a web page can read every key in it. The build stops when the page would carry
 * a key that can write or reach an account: a write key (ow_w_), a seat secret (ow_s_) or an
 * account token (ow_a_), in VITE_OW_READ_KEY or anywhere in the built files.
 */
const SECRET = /ow_[wsa]_[A-Za-z0-9_-]{16,}/;
function noSecrets(env: Record<string, string>): Plugin {
  return {
    name: 'no-secrets',
    apply: 'build',
    buildStart() {
      const k = (env.VITE_OW_READ_KEY ?? '').trim();
      if (k && !k.startsWith('ow_r_')) this.error('VITE_OW_READ_KEY must be a read key (it starts with ow_r_). A write key in a web page can be read and used by anyone who opens it.');
    },
    generateBundle(_, bundle) {
      for (const [file, out] of Object.entries(bundle)) {
        const text = out.type === 'chunk' ? out.code : typeof out.source === 'string' ? out.source : '';
        if (SECRET.test(text)) this.error(`${file} holds what looks like a write key, seat secret or account token. Take it out of the code: this page only needs a read key.`);
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative paths, so the same build works at a domain's root (Cloudflare Pages) and under a
  // repository's path (GitHub Pages, https://<you>.github.io/<repo>/).
  base: './',
  plugins: [policyInPage(), noSecrets(loadEnv(mode, process.cwd(), 'VITE_'))],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
