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
        // 个人设置
        {
          path: 'personal',
          name: 'personal',
          component: () => import('@/views/SettingsView.vue'),
          meta: { settingsGroup: 'personal' },
          children: [
            { path: '', redirect: { name: 'personal-profile' } },
            { path: 'profile', name: 'personal-profile', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'personal', settingsTab: 'profile' } },
            { path: 'invitation', name: 'personal-invitation', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'personal', settingsTab: 'invitation' } },
            { path: 'about', name: 'personal-about', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'personal', settingsTab: 'about' } },
          ],
        },
        // 组织管理（管理员专属）
        {
          path: 'organization',
          name: 'organization',
          component: () => import('@/views/SettingsView.vue'),
          meta: { settingsGroup: 'organization', adminOnly: true },
          children: [
            { path: '', redirect: { name: 'org-users' } },
            { path: 'users', name: 'org-users', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'organization', settingsTab: 'user', adminOnly: true } },
            { path: 'roles', name: 'org-roles', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'organization', settingsTab: 'role', adminOnly: true } },
            { path: 'departments', name: 'org-departments', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'organization', settingsTab: 'organization', adminOnly: true } },
          ],
        },
        // 系统设置（管理员专属）
        {
          path: 'system',
          name: 'system',
          component: () => import('@/views/SettingsView.vue'),
          meta: { settingsGroup: 'system', adminOnly: true },
          children: [
            { path: '', redirect: { name: 'sys-models' } },
            { path: 'models', name: 'sys-models', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'system', settingsTab: 'model', adminOnly: true } },
            { path: 'experts', name: 'sys-experts', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'system', settingsTab: 'expert', adminOnly: true } },
            { path: 'assistants', name: 'sys-assistants', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'system', settingsTab: 'assistant', adminOnly: true } },
            { path: 'resident', name: 'sys-resident', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'system', settingsTab: 'resident', adminOnly: true } },
            { path: 'attachments', name: 'sys-attachments', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'system', settingsTab: 'attachment', adminOnly: true } },
            { path: 'mcp', name: 'sys-mcp', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'system', settingsTab: 'mcp', adminOnly: true } },
            { path: 'apps', name: 'sys-apps', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'system', settingsTab: 'apps', adminOnly: true } },
            { path: 'handlers', name: 'sys-handlers', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'system', settingsTab: 'handlers', adminOnly: true } },
            { path: 'config', name: 'sys-config', component: () => import('@/views/SettingsView.vue'), meta: { settingsGroup: 'system', settingsTab: 'system', adminOnly: true } },
          ],
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
        {
          path: 'contract-v2',
          name: 'contract-v2',
          component: () => import('@/views/contract-v2/ContractV2View.vue'),
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
router.beforeEach(async (to, from) => {
  const userStore = useUserStore()
  const token = localStorage.getItem('access_token')

  if (token && !userStore.isLoggedIn && !userStore.isLoading) {
    try {
      await userStore.loadUser()
    } catch (error) {
      console.error('Failed to load user:', error)
    }
  }

  if (!to.meta.public && !userStore.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.name === 'login' && userStore.isLoggedIn) {
    return { name: 'experts' }
  }

  if (to.name === 'chat' && !to.params.expertId) {
    return { name: 'experts' }
  }

  document.title = to.meta.title ? `${to.meta.title} - Touwaka Mate` : 'Touwaka Mate'
  document.documentElement.setAttribute('lang', getLocale())
})

export default router
