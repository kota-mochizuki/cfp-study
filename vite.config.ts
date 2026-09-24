import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'CFP Study',
        short_name: 'CFP',
        description: 'CFP資格審査試験 6課目合格のための学習アプリ',
        lang: 'ja',
        start_url: './',
        display: 'standalone',
        background_color: '#f7f7f5',
        theme_color: '#1f3a5f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      // アプリ本体を丸ごとキャッシュし、電波がなくても起動できるようにする（問題データは端末の IndexedDB）
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'], navigateFallback: 'index.html', maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
    }),
  ],
  test: { environment: 'node', setupFiles: ['./src/test/setup.ts'] },
});
