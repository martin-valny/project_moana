import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Shown by the ?debug=1 overlay, so a phone screenshot proves which build it
// was taken from (a stale cached page looks identical otherwise).
let buildId = new Date().toISOString()
try {
  buildId = `${execSync('git rev-parse --short HEAD').toString().trim()} ${buildId}`
} catch {
  // not a git checkout — the timestamp alone still identifies the build
}

// GitHub Pages serves a project repo (not a <user>.github.io repo) from a
// subpath, https://<user>.github.io/<repo>/ — everything else (preview,
// dev, other hosts that serve from the domain root) keeps the default "/".
// The one place this matters at runtime, not just for Vite's own asset
// URLs, is GlobeSphere.tsx's two texture loads, which read this same env
// var via import.meta.env.BASE_URL rather than a hardcoded absolute path.
const base = process.env.GITHUB_PAGES === 'true' ? '/project_moana/' : '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react()],
})
