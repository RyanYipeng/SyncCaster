import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from 'unocss/vite';
import { resolve } from 'path';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { build } from 'esbuild';
import manifest from './src/manifest';

// 插件：生成 manifest.json 和转换 content-scripts 为 IIFE
function buildExtension() {
  return {
    name: 'build-extension',
    async closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      
      // 确保 dist 目录存在
      if (!existsSync(distDir)) {
        mkdirSync(distDir, { recursive: true });
      }

      // 1. 生成 manifest.json
      console.log('Generating manifest.json...');
      writeFileSync(
        resolve(distDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );

      // 2. 转换 content-scripts 为 IIFE
      const contentScriptPath = resolve(__dirname, 'src/content-scripts/index.ts');
      if (existsSync(contentScriptPath)) {
        console.log('Building content-scripts.js as IIFE...');
        await build({
          entryPoints: [contentScriptPath],
          bundle: true,
          format: 'iife',
          globalName: 'ContentScript',
          outfile: resolve(distDir, 'content-scripts.js'),
          platform: 'browser',
          target: 'es2020',
          minify: false,
          alias: {
            '@': resolve(__dirname, 'src'),
          },
        });
      }

      // 3. 复制 icons 目录（如果存在）
      const iconsDir = resolve(__dirname, 'public/icons');
      if (existsSync(iconsDir)) {
        console.log('Copying icons...');
        const distIconsDir = resolve(distDir, 'icons');
        if (!existsSync(distIconsDir)) {
          mkdirSync(distIconsDir, { recursive: true });
        }
        // 这里可以添加复制逻辑
      }

      console.log('✓ Extension files generated');
    },
  };
}

export default defineConfig({
  plugins: [vue(), UnoCSS(), buildExtension()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@synccaster/core': resolve(__dirname, '../../packages/core/src'),
      '@synccaster/adapters': resolve(__dirname, '../../packages/adapters/src'),
      '@synccaster/utils': resolve(__dirname, '../../packages/utils/src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/ui/popup/index.html'),
        options: resolve(__dirname, 'src/ui/options/index.html'),
        sidepanel: resolve(__dirname, 'src/ui/sidepanel/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        // content-scripts 会被 buildExtension 插件单独处理
      },
      output: {
        entryFileNames: (chunkInfo: any) => {
          if (chunkInfo.name === 'background') {
            return '[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
