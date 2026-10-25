import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/naive-ui') || id.includes('node_modules/vueuc') || id.includes('node_modules/seemly')) return 'naive';
          if (id.includes('node_modules/vue/') || id.includes('node_modules/@vue')) return 'vue';
          if (id.includes('@iconify-json')) return 'icons';
          if (id.includes('node_modules/qrcode')) return 'qrcode';
        },
      },
    },
  },
});
