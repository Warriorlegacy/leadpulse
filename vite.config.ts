import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built assets go to `public/` (a conventional source directory name) so that a
// deploy sandbox which strips `dist/`/`build/` still receives a complete app.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: 'public',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
