import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: 'apps/desktop/renderer', base: './',
  // Monaco 0.57 exports JavaScript entry points only; its selective editor API
  // needs the codicon stylesheet, bundled here together with its local font.
  resolve: { alias: { 'monaco-codicons': fileURLToPath(new URL('./node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css', import.meta.url)) } },
  build: { outDir: '../../../dist/renderer', emptyOutDir: true },
  server: { host: '127.0.0.1' }
});
