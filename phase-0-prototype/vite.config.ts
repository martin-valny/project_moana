import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  plugins: [react()],
})
