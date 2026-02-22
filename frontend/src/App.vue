<template>
  <RouterView />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useI18n } from 'vue-i18n'

const userStore = useUserStore()
const { locale } = useI18n()

onMounted(() => {
  // 初始化语言设置
  // 注意：用户状态由路由守卫处理，避免重复加载
  const init = async () => {
    // 如果用户已登录且已加载偏好设置，应用语言设置
    if (userStore.isLoggedIn && userStore.preferences?.language) {
      locale.value = userStore.preferences.language
    }
  }
  init()
})
</script>

<style>
/* 全局样式 */
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary, #333);
  background: var(--main-bg, #f5f5f5);
}

/* CSS 变量 - 主题配置 */
:root {
  /* 主色调 */
  --primary-color: #2196f3;
  --primary-hover: #1976d2;
  --primary-light: #e3f2fd;

  /* 背景色 */
  --main-bg: #f5f5f5;
  --card-bg: #ffffff;
  --header-bg: #ffffff;
  --sidebar-bg: #ffffff;
  --secondary-bg: #f5f5f5;
  --hover-bg: #e8e8e8;

  /* 文字颜色 */
  --text-primary: #333333;
  --text-secondary: #666666;
  --text-tertiary: #999999;

  /* 边框 */
  --border-color: #e0e0e0;
  --border-light: #eeeeee;

  /* 状态色 */
  --success-color: #4caf50;
  --warning-color: #ff9800;
  --error-color: #f44336;

  /* 间距 */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  /* 圆角 */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
}

/* 暗色主题 */
[data-theme="dark"] {
  --main-bg: #1a1a2e;
  --card-bg: #16213e;
  --header-bg: #0f3460;
  --sidebar-bg: #16213e;
  --secondary-bg: #0f3460;
  --hover-bg: #1f4068;

  --text-primary: #e8e8e8;
  --text-secondary: #a0a0a0;
  --text-tertiary: #666666;

  --border-color: #1f4068;
  --border-light: #16213e;
}

/* 通用样式 */
.btn {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-secondary {
  background: var(--secondary-bg);
  color: var(--text-secondary);
}

.btn-secondary:hover {
  background: var(--hover-bg);
}

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

/* 动画 */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.fade-in {
  animation: fadeIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    transform: translateY(10px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.slide-in {
  animation: slideIn 0.3s ease-out;
}

/* 加载动画 */
.loading-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 骨架屏 */
.skeleton {
  background: linear-gradient(
    90deg,
    var(--secondary-bg) 25%,
    var(--hover-bg) 50%,
    var(--secondary-bg) 75%
  );
  background-size: 200% 100%;
  animation: skeleton 1.5s ease-in-out infinite;
}

@keyframes skeleton {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
