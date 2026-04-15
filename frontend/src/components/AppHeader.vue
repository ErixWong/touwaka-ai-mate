<template>
  <header class="app-header">
    <div class="header-left">
      <router-link to="/experts" class="logo">
        <span class="logo-icon">🤖</span>
        <span class="logo-text">Touwaka Mate</span>
      </router-link>
    </div>

    <nav class="header-nav">
      <router-link to="/experts" class="nav-link" :class="{ active: isActive('/experts') }">
        <span class="nav-icon">🤖</span>
        <span class="nav-text">{{ $t('nav.experts') }}</span>
      </router-link>

      <router-link to="/skills" class="nav-link" :class="{ active: isActive('/skills') }">
        <span class="nav-icon">🧩</span>
        <span class="nav-text">{{ $t('nav.skills') }}</span>
      </router-link>

      <router-link to="/knowledge" class="nav-link" :class="{ active: isActive('/knowledge') }">
        <span class="nav-icon">📚</span>
        <span class="nav-text">{{ $t('knowledgeBase.title') }}</span>
      </router-link>

      <router-link to="/solutions" class="nav-link" :class="{ active: isActive('/solutions') }">
        <span class="nav-icon">🎯</span>
        <span class="nav-text">{{ $t('solutions.title', '解决方案') }}</span>
      </router-link>

      <router-link to="/apps" class="nav-link" :class="{ active: isActive('/apps') }">
        <span class="nav-icon">📱</span>
        <span class="nav-text">{{ $t('apps.title', 'App') }}</span>
      </router-link>

      <router-link to="/organization" class="nav-link" :class="{ active: isActive('/organization') }" v-if="isAdmin">
        <span class="nav-icon">🏢</span>
        <span class="nav-text">{{ $t('nav.organization') }}</span>
      </router-link>

      <router-link to="/personal" class="nav-link" :class="{ active: isActive('/personal') }">
        <span class="nav-icon">👤</span>
        <span class="nav-text">{{ $t('nav.personal') }}</span>
      </router-link>

      <router-link to="/system" class="nav-link" :class="{ active: isActive('/system') }" v-if="isAdmin">
        <span class="nav-icon">⚙️</span>
        <span class="nav-text">{{ $t('nav.system') }}</span>
      </router-link>
    </nav>

    <div class="header-right">
      <!-- 语言切换 -->
      <div class="lang-selector">
        <select v-model="currentLocale" @change="handleLocaleChange" class="lang-select">
          <option value="zh-CN">中文</option>
          <option value="en-US">English</option>
        </select>
      </div>
      
      <div class="user-menu" ref="menuRef">
        <button class="btn-user" @click="showUserMenu = !showUserMenu">
          <span class="user-avatar">{{ userInitial }}</span>
          <span class="user-name">{{ userStore.user?.nickname }}</span>
          <span class="arrow">▼</span>
        </button>
        <div class="user-dropdown" v-if="showUserMenu">
          <div class="dropdown-header">
            <div class="dropdown-username">{{ userStore.user?.nickname }}</div>
            <div class="dropdown-email">{{ userStore.user?.email }}</div>
          </div>
          <div class="dropdown-divider"></div>
          <router-link to="/personal" class="dropdown-item" @click="showUserMenu = false">
            <span class="item-icon">👤</span>
            <span>{{ $t('nav.personal') }}</span>
          </router-link>
          <button class="dropdown-item" @click="handleLogout">
            <span class="item-icon">🚪</span>
            <span>{{ $t('nav.logout') }}</span>
          </button>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useI18n } from 'vue-i18n'
import type { Locale } from '@/i18n'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const { locale } = useI18n()

const showUserMenu = ref(false)
const menuRef = ref<HTMLElement | null>(null)

// 是否为管理员
const isAdmin = computed(() => userStore.isAdmin)

// 当前语言
const currentLocale = computed({
  get: () => locale.value as Locale,
  set: (value: Locale) => {
    locale.value = value
  }
})

// 处理语言切换
const handleLocaleChange = async () => {
  await userStore.changeLanguage(currentLocale.value)
}

const userInitial = computed(() => {
  return userStore.user?.nickname?.charAt(0).toUpperCase() || 'U'
})

const isActive = (path: string) => {
  if (path === '/experts') {
    // 专家页面和聊天页面都高亮专家导航（因为聊天基于专家）
    return route.path === '/experts' || route.path === '/' || route.path.startsWith('/chat')
  }
  // 设置相关页面高亮
  if (path === '/organization' || path === '/personal' || path === '/system') {
    return route.path === path || route.path.startsWith(`${path}/`)
  }
  return route.path.startsWith(path)
}

const handleLogout = async () => {
  showUserMenu.value = false
  await userStore.logout()
  router.push({ name: 'login' })
}

// 点击外部关闭下拉菜单
const handleClickOutside = (event: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    showUserMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 16px;
  background: var(--header-bg, #ffffff);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  position: sticky;
  top: 0;
  z-index: 50;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--text-primary, #333);
}

.logo-icon {
  font-size: 24px;
}

.logo-text {
  font-size: 18px;
  font-weight: 600;
}

.header-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  text-decoration: none;
  color: var(--text-secondary, #666);
  border-radius: 8px;
  transition: all 0.2s;
}

.nav-link:hover {
  background: var(--hover-bg, #e8e8e8);
  color: var(--text-primary, #333);
}

.nav-link.active {
  background: var(--primary-light, #e3f2fd);
  color: var(--primary-color, #2196f3);
}

.nav-icon {
  font-size: 16px;
}

.nav-text {
  font-size: 14px;
  font-weight: 500;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 语言选择器 */
.lang-selector {
  display: flex;
  align-items: center;
}

.lang-select {
  padding: 6px 12px;
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary, #333);
  cursor: pointer;
  transition: all 0.2s;
}

.lang-select:hover {
  border-color: var(--primary-color, #2196f3);
}

.lang-select:focus {
  outline: none;
  border-color: var(--primary-color, #2196f3);
  box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.1);
}

.user-menu {
  position: relative;
}

.btn-user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 24px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-user:hover {
  background: var(--hover-bg, #e8e8e8);
}

.user-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--primary-color, #2196f3);
  color: white;
  border-radius: 50%;
  font-size: 14px;
  font-weight: 600;
}

.user-name {
  font-size: 14px;
  color: var(--text-primary, #333);
}

.arrow {
  font-size: 10px;
  color: var(--text-tertiary, #999);
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dropdown-header {
  padding: 12px 16px;
}

.dropdown-username {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.dropdown-email {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-top: 2px;
}

.dropdown-divider {
  height: 1px;
  background: var(--border-color, #e0e0e0);
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 16px;
  background: transparent;
  border: none;
  text-decoration: none;
  font-size: 14px;
  color: var(--text-primary, #333);
  cursor: pointer;
  transition: background 0.2s;
}

.dropdown-item:hover {
  background: var(--hover-bg, #e8e8e8);
}

.item-icon {
  font-size: 16px;
}

@media (max-width: 768px) {
  .logo-text {
    display: none;
  }

  .nav-text {
    display: none;
  }

  .nav-link {
    padding: 8px;
  }

  .user-name {
    display: none;
  }

  .arrow {
    display: none;
  }
}
</style>
