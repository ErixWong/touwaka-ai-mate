import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    host: true,  // 监听所有网络接口（包括 localhost 和 127.0.0.1）
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // 附件静态文件服务代理
      '/attach': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // 任务静态文件服务代理
      '/task-static': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // SSE 流式接口需要单独配置，禁用缓冲
      '/api/chat/stream': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // 禁用代理缓冲，确保 SSE 事件实时转发
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // 设置 SSE 相关的请求头
            proxyReq.setHeader('Cache-Control', 'no-cache');
            proxyReq.setHeader('Accept', 'text/event-stream');
          });
          proxy.on('proxyRes', (proxyRes) => {
            // 确保响应不被缓冲
            proxyRes.headers['cache-control'] = 'no-cache';
            proxyRes.headers['x-accel-buffering'] = 'no';
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
          elementPlus: ['element-plus'],
          i18n: ['vue-i18n'],
          chatbot: ['@aivue/chatbot'],
        },
      },
    },
  },
})
