import path from 'node:path'
import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

/**
 * Extension-specific Vite configuration for md-editor
 * 
 * This config builds the md project for integration into the SyncCaster extension.
 * Key differences from the main config:
 * - Base path is relative (./) for extension compatibility
 * - Analytics and external dependencies are disabled
 * - Output goes to the extension's public folder
 * - All assets are bundled locally for offline use
 */
export default defineConfig({
  base: './',
  define: { process },
  envPrefix: ['VITE_', 'CF_'],
  plugins: [
    vue(),
    tailwindcss(),
    nodePolyfills({
      include: ['path', 'util', 'timers', 'stream', 'fs'],
    }),
    // No analytics for extension build
    AutoImport({
      imports: ['vue', 'pinia', '@vueuse/core'],
      dirs: ['./src/stores', './src/utils/toast', './src/composables'],
    }),
    Components({
      resolvers: [],
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  css: { devSourcemap: false },
  build: {
    // Output to extension's public folder
    outDir: path.resolve(__dirname, '../../../apps/extension/public/md-editor'),
    emptyOutDir: true,
    // Inline mermaid instead of external
    rollupOptions: {
      output: {
        chunkFileNames: 'static/js/md-[name]-[hash].js',
        entryFileNames: 'static/js/md-[name]-[hash].js',
        assetFileNames: 'static/[ext]/md-[name]-[hash].[ext]',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('katex'))
              return 'katex'
            if (id.includes('highlight.js'))
              return 'hljs'
            if (id.includes('codemirror'))
              return 'codemirror'
            if (id.includes('prettier'))
              return 'prettier'
            if (id.includes('mermaid'))
              return 'mermaid'
            const pkg = id
              .split('node_modules/')[1]
              .split('/')[0]
              .replace('@', 'npm_')
            return `vendor_${pkg}`
          }
        },
      },
    },
  },
})
