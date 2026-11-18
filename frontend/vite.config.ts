import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

// The HighLevel resource registry lives at the repo root (shared with the functions); the dev server may read that
// folder and nothing else outside the frontend.
const hlResources = path.resolve(import.meta.dirname, '../hl-resources')

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // The dev server watches only frontend/: also watch the registry, so a new resource file shows up without a restart.
    { name: 'watch-hl-resources', configureServer: (server) => { server.watcher.add(hlResources) } },
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src'), '@hl-resources': hlResources } },
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), hlResources] } },
})
