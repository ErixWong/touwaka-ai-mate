import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { getLocale } from '@/i18n'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/RegisterView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      children: [
        {
          path: '',
          redirect: '/experts',
        },
        {
          path: 'experts',
          name: 'experts',
          component: () => import('@/views/HomeView.vue'),
        },
        {
          path: 'chat/:expertId',
          name: 'chat',
          component: () => import('@/views/ChatView.vue'),
        },
        {
          path: 'chat/:expertId/task/:taskId',
          name: 'chat-with-task',
          component: () => import('@/views/ChatView.vue'),
        },
        {
          path: 'chat/:expertId/skill/:skillName',
          name: 'chat-with-skill',
          component: () => import('@/views/ChatView.vue'),
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue'),
        },
        // 组织管理（管理员专属）
        {
          path: 'organization',
          name: 'organization',
          component: () => import('@/views/SettingsView.vue'),
          meta: { settingsGroup: 'organization', adminOnly: true },
        },
        // 个人设置（所有用户）
        {
          path: 'personal',
          name: 'personal',
          component: () => import('@/views/SettingsView.vue'),
          meta: { settingsGroup: 'personal' },
        },
        // 系统设置（管理员专属）
        {
          path: 'system',
          name: 'system',
          component: () => import('@/views/SettingsView.vue'),
          meta: { settingsGroup: 'system', adminOnly: true },
        },
        {
          path: 'skills',
          name: 'skills',
          component: () => import('@/views/SkillsView.vue'),
        },
        {
          path: 'knowledge',
          name: 'knowledge',
          component: () => import('@/views/KnowledgeBaseView.vue'),
        },
        {
          path: 'knowledge/:kbId',
          name: 'knowledge-detail',
          component: () => import('@/views/KnowledgeDetailView.vue'),
        },
        {
          path: 'solutions',
          name: 'solutions',
          component: () => import('@/views/SolutionsView.vue'),
        },
        {
          path: 'solutions/:id',
          name: 'solution-detail',
          component: () => import('@/views/SolutionDetailView.vue'),
        },
        {
          path: 'apps',
          name: 'apps',
          component: () => import('@/views/AppsView.vue'),
        },
        {
          path: 'apps/:appId',
          name: 'app-detail',
          component: () => import('@/views/AppDetailView.vue'),
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
})

// 路由守卫
router.beforeEach(async (to, from, next) => {
  const userStore = useUserStore()
  const token = localStorage.getItem('access_token')

  // 如果有 token 但用户信息未加载，先尝试加载
  if (token && !userStore.isLoggedIn && !userStore.isLoading) {
    try {
      await userStore.loadUser()
    } catch (error) {
      console.error('Failed to load user:', error)
      // 加载失败，清除登录状态
      // 注意：loadUser 内部已经清除了 token 和状态
    }
  }

  // 检查是否需要登录
  if (!to.meta.public && !userStore.isLoggedIn) {
    // 仍然未登录，跳转到登录页
    next({ name: 'login', query: { redirect: to.fullPath } })
    return
  }

  // 如果已登录访问登录页，跳转到专家页
  if (to.name === 'login' && userStore.isLoggedIn) {
    next({ name: 'experts' })
    return
  }

  // 如果访问聊天页面但没有有效的 expertId，重定向到专家选择页面
  if (to.name === 'chat' && !to.params.expertId) {
    next({ name: 'experts' })
    return
  }

  // 设置页面标题
  const defaultTitle = 'Touwaka Mate'
  document.title = to.meta.title ? `${to.meta.title} - ${defaultTitle}` : defaultTitle

  // 设置 HTML lang 属性
  document.documentElement.setAttribute('lang', getLocale())

  next()
})

export default router
