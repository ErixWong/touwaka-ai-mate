import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    ...(command === 'serve' ? [vueDevTools()] : []),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      dirs: ['src/components', '../apps/**/frontend/components'],
      dts: './components.d.ts',
      resolvers: [ElementPlusResolver()],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@apps': fileURLToPath(new URL('../apps', import.meta.url)),
      'vue': fileURLToPath(new URL('./node_modules/vue', import.meta.url)),
      'pinia': fileURLToPath(new URL('./node_modules/pinia', import.meta.url)),
      'element-plus': fileURLToPath(new URL('./node_modules/element-plus', import.meta.url)),
      '@element-plus/icons-vue': fileURLToPath(new URL('./node_modules/@element-plus/icons-vue', import.meta.url)),
      'echarts': fileURLToPath(new URL('./node_modules/echarts', import.meta.url)),
      'exceljs': fileURLToPath(new URL('./node_modules/exceljs', import.meta.url))
    },
    dedupe: ['vue', 'pinia', 'element-plus', '@element-plus/icons-vue', 'echarts', 'exceljs'],
  },
  server: {
    host: true,  // 监听所有网络接口（包括 localhost 和 127.0.0.1）
    port: 5173,
    fs: {
      // apps/**/frontend 在 vite root 之外，worker 等独立入口脚本不经过 ESM 模块图，
      // 必须显式放行仓库根目录，否则 dev 下 worker 脚本 403 导致本地分析悬挂
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3017',
        changeOrigin: true,
      },
      // 附件静态文件服务代理
      '/attach': {
        target: 'http://localhost:3017',
        changeOrigin: true,
      },
      // 任务静态文件服务代理
      '/task-static': {
        target: 'http://localhost:3017',
        changeOrigin: true,
      },
      // SSE 流式接口需要单独配置，禁用缓冲
      '/api/chat/stream': {
        target: 'http://localhost:3017',
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
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('echarts') || id.includes('vue-echarts')) {
              return 'echarts'
            }
            if (id.includes('katex')) {
              return 'katex'
            }
            if (id.includes('mermaid')) {
              return 'mermaid'
            }
            if (id.includes('marked') || id.includes('dompurify')) {
              return 'markdown'
            }
            if (id.includes('vue-i18n')) {
              return 'i18n'
            }
            if (id.includes('node_modules/vue') || id.includes('node_modules/vue-router') || id.includes('node_modules/pinia')) {
              if (id.includes('node_modules/mermaid') || id.includes('node_modules/d3') || id.includes('node_modules/dagre')) {
                return 'mermaid'
              }
              return 'vendor'
            }
          }
        },
      },
    },
  },
}))
