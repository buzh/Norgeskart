import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { defineConfig } from 'vite';

// Falls back to 'unknown' when building outside a git checkout (e.g. a Docker
// build stage that doesn't COPY .git) so the build doesn't crash over a label.
function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

const commitHash = getCommitHash();
const buildDate = new Date().toISOString();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  build: {
    sourcemap: true,
  },
  server: {
    port: 3000,
  },
  preview: {
    port: 4173,
  },
});
