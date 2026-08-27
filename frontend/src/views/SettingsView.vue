<template>
  <div class="settings-view">
    <!-- 左侧菜单 -->
    <el-menu
      :default-active="activeTab"
      :collapse="sidebarCollapsed"
      class="settings-sidebar"
      @select="handleMenuSelect"
    >
      <el-menu-item
        v-for="item in currentMenuItems"
        :key="item.key"
        :index="item.key"
      >
        <span>{{ item.label }}</span>
      </el-menu-item>
    </el-menu>

    <!-- 右侧主显示区 -->
    <div class="settings-main">

    <div v-if="activeTab === 'profile'" class="settings-section profile-section">
      <ProfileSecurityTab />
    </div>

    <!-- 邀请管理 -->
    <div v-if="activeTab === 'invitation'" class="settings-section invitation-section">
      <InvitationTab />
    </div>

    <div v-if="activeTab === 'model'" class="settings-section model-provider-section">
      <ModelProviderTab />
    </div>

    <div v-if="activeTab === 'expert' && isAdmin" class="settings-section expert-section">
      <ExpertSettingsTab />
    </div>

    <!-- 系统配置（仅管理员） -->
    <div v-if="activeTab === 'system' && isAdmin" class="settings-section system-section">
      <SystemConfigTab />
    </div>

    <!-- 用户管理 -->
    <div v-if="activeTab === 'user' && isAdmin" class="settings-section user-section">
      <div class="panel-header">
        <h3 class="panel-title">{{ $t('settings.userManagement') }}</h3>
        <el-button @click="openUserDialog()" :title="$t('settings.addUser')">
          + {{ $t('settings.addUser') }}
        </el-button>
      </div>

      <!-- 搜索过滤 -->
      <div class="user-search">
        <el-input
          v-model="userSearchQuery"
          :placeholder="$t('settings.searchUsersPlaceholder')"
          clearable
          @input="handleUserSearch"
        />
      </div>

      <div v-if="usersLoading" class="loading-state">
        {{ $t('common.loading') }}
      </div>

      <div v-else-if="usersList.length === 0" class="empty-state">
        {{ userSearchQuery ? $t('settings.noUsersFound') : $t('settings.noUsers') }}
      </div>

      <div v-else class="user-list-container">
        <div class="user-list">
          <div
            v-for="user in usersList"
            :key="user.id"
            class="user-item"
            :class="{ inactive: user.status !== 'active' }"
          >
            <div class="user-avatar">
              <span v-if="!user.avatar">👤</span>
              <img v-else :src="user.avatar" alt="avatar" />
            </div>
            <div class="user-info">
              <div class="user-header">
                <span class="user-name">{{ user.nickname || user.username }}</span>
                <span v-if="user.status !== 'active'" class="badge inactive">
                  {{ $t(`settings.userStatus.${user.status}`) }}
                </span>
                <span v-if="user.roles && user.roles.length > 0" class="user-roles">
                  {{ user.roles.join(', ') }}
                </span>
              </div>
              <div class="user-meta">
                <span class="user-email">{{ user.email }}</span>
                <span class="user-username">@{{ user.username }}</span>
                <span v-if="user.invitation_quota !== undefined" class="user-invitation-quota">
                  {{ $t('settings.invitationQuota') }}: {{ user.invitation_quota }}
                </span>
              </div>
            </div>
            <div class="user-actions">
              <el-button size="small" @click="openUserDialog(user)">
                {{ $t('common.edit') }}
              </el-button>
              <el-button size="small" type="danger" @click="confirmDeleteUser(user)">
                {{ $t('common.delete') }}
              </el-button>
            </div>
          </div>
        </div>

        <!-- 用户分页 -->
        <Pagination
          v-if="userTotalPages > 1"
          :current-page="userPage"
          :total-pages="userTotalPages"
          :total="usersList.length"
          @change="(page) => userPage = page"
        />
      </div>
    </div>

    <!-- 角色管理 -->
    <div v-if="activeTab === 'role' && canManageRoles" class="settings-section role-section">
      <div class="split-panel">
        <!-- 左侧：角色列表 -->
        <div class="panel role-list-panel">
          <div class="panel-header">
            <h3 class="panel-title">{{ $t('settings.roleManagement') }}</h3>
          </div>

          <div v-if="rolesLoading" class="loading-state">
            {{ $t('common.loading') }}
          </div>

          <div v-else-if="rolesList.length === 0" class="empty-state">
            {{ $t('settings.noRoles') }}
          </div>

          <div v-else class="role-list-container">
            <div class="role-list">
              <div
                v-for="role in rolesList"
                :key="role.id"
                class="role-item"
                :class="{ active: selectedRole?.id === role.id, system: role.is_system }"
              >
                <button
                  class="role-name-btn"
                  @click="selectRole(role)"
                >
                  <span class="role-name">{{ role.name }}</span>
                  <span v-if="role.is_system" class="badge system">
                    {{ $t('settings.builtinSkill') }}
                  </span>
                </button>
                <el-button size="small" @click.stop="openRoleDialog(role)">
                  {{ $t('common.edit') }}
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：权限配置和专家访问权限 -->
        <div class="panel role-detail-panel">
          <div v-if="!selectedRole" class="empty-state select-role-hint">
            {{ $t('settings.selectRoleHint') }}
          </div>

          <template v-else>
            <el-tabs v-model="roleSubTab" class="role-tabs">
              <el-tab-pane :label="$t('settings.permissionConfig')" name="permissions">
                <div v-if="rolePermissionsLoading" class="loading-state">
                  {{ $t('common.loading') }}
                </div>

                <div v-else class="permissions-list">
                  <el-checkbox-group v-model="rolePermissionIds" @change="rolePermissionsChanged = true">
                    <el-checkbox
                      v-for="permission in allPermissions"
                      :key="permission.id"
                      :value="permission.id"
                      :label="permission.name"
                    >
                      <span class="permission-info">
                        <span class="permission-name">{{ permission.name }}</span>
                        <span v-if="permission.description" class="permission-desc">
                          {{ permission.description }}
                        </span>
                      </span>
                    </el-checkbox>
                  </el-checkbox-group>
                </div>

                <div v-if="!rolePermissionsLoading && allPermissions.length === 0" class="empty-state">
                  {{ $t('settings.noPermissionsAvailable') }}
                </div>

                <div class="role-tab-footer">
                  <span class="permissions-count">
                    {{ $t('settings.selectedPermissionsCount', { count: rolePermissionIds.length }) }}
                  </span>
                  <el-button
                    type="primary"
                    :disabled="!rolePermissionsChanged"
                    @click="saveRolePermissions"
                  >
                    {{ $t('common.save') }}
                  </el-button>
                </div>
              </el-tab-pane>

              <el-tab-pane :label="$t('settings.expertAccess')" name="experts">
                <div v-if="roleExpertsLoading" class="loading-state">
                  {{ $t('common.loading') }}
                </div>

                <div v-else class="experts-list">
                  <el-checkbox-group v-model="roleExpertIds" @change="roleExpertsChanged = true">
                    <el-checkbox
                      v-for="expert in allExperts"
                      :key="expert.id"
                      :value="expert.id"
                      :label="expert.name"
                    >
                      <span class="expert-info">
                        <span class="expert-name">{{ expert.name }}</span>
                        <span v-if="expert.introduction" class="expert-intro">
                          {{ expert.introduction }}
                        </span>
                      </span>
                    </el-checkbox>
                  </el-checkbox-group>
                </div>

                <div v-if="!roleExpertsLoading && allExperts.length === 0" class="empty-state">
                  {{ $t('settings.noExpertsAvailable') }}
                </div>

                <div class="role-tab-footer">
                  <span class="experts-count">
                    {{ $t('settings.selectedExpertsCount', { count: roleExpertIds.length }) }}
                  </span>
                  <el-button
                    type="primary"
                    :disabled="!roleExpertsChanged"
                    @click="saveRoleExperts"
                  >
                    {{ $t('common.save') }}
                  </el-button>
                </div>
              </el-tab-pane>
            </el-tabs>
          </template>
        </div>
      </div>
    </div>

    <!-- 组织架构管理 -->
    <div v-if="activeTab === 'organization'" class="settings-section organization-section">
      <OrganizationTab />
    </div>

    <!-- 驻留进程管理（仅管理员） -->
    <div v-if="activeTab === 'resident' && isAdmin" class="settings-section resident-section">
      <ResidentProcessesTab />
    </div>

    <!-- 附件管理（仅管理员） -->
    <div v-if="activeTab === 'attachment' && isAdmin" class="settings-section attachment-section">
      <AttachmentTab />
    </div>

    <!-- MCP 管理（仅管理员） -->
    <div v-if="activeTab === 'mcp' && isAdmin" class="settings-section mcp-section">
      <McpTab />
    </div>

    <!-- App 管理（仅管理员） -->
    <div v-if="activeTab === 'apps' && isAdmin" class="settings-section apps-section">
      <AppManagementTab />
    </div>

    <!-- AppClock 运行状态（仅管理员） -->
    <div v-if="activeTab === 'appClock' && isAdmin" class="settings-section appclock-section">
      <AppClockStatusTab />
    </div>

    <!-- 关于 -->
    <div v-if="activeTab === 'about'" class="settings-section">
      <div class="about-content">
        <h2 class="app-name">{{ $t('app.title') }}</h2>
        <p class="app-version">Version {{ appVersion }}</p>
        <p class="app-description">{{ $t('app.description') }}</p>
      </div>
    </div>

    <!-- 用户添加/编辑对话框 -->
    <el-dialog
      v-model="showUserDialog"
      :title="editingUser ? $t('settings.editUser') : $t('settings.addUser')"
      width="700px"
    >
      <el-form label-width="100px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item :label="$t('settings.username')" required>
              <el-input
                v-model="userForm.username"
                :placeholder="$t('settings.usernamePlaceholder')"
                @input="handleUsernameInput"
              />
              <div class="el-form-item__tip">{{ $t('settings.usernameFormatHint') }}</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="$t('settings.email')" required>
              <el-input
                v-model="userForm.email"
                type="email"
                :placeholder="$t('settings.emailPlaceholder')"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item v-if="!editingUser" :label="$t('settings.password')" required>
          <el-input
            v-model="userForm.password"
            type="password"
            :placeholder="$t('settings.passwordPlaceholder')"
            show-password
          />
        </el-form-item>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item :label="$t('settings.userNickname')">
              <el-input
                v-model="userForm.nickname"
                :placeholder="$t('settings.userNicknamePlaceholder')"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="$t('settings.userStatusText')">
              <el-select v-model="userForm.status">
                <el-option label="active" value="active">{{ $t('settings.userStatus.active') }}</el-option>
                <el-option label="inactive" value="inactive">{{ $t('settings.userStatus.inactive') }}</el-option>
                <el-option label="banned" value="banned">{{ $t('settings.userStatus.banned') }}</el-option>
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item :label="$t('settings.userRoles')">
          <div v-if="rolesLoading">{{ $t('common.loading') }}</div>
          <el-checkbox-group v-else v-model="userForm.selectedRoleIds">
            <el-checkbox v-for="role in rolesList" :key="role.id" :value="role.id">
              {{ role.name }}
              <el-tag v-if="role.is_system" type="info" size="small">{{ $t('settings.builtinSkill') }}</el-tag>
            </el-checkbox>
          </el-checkbox-group>
          <div v-if="rolesList.length === 0 && !rolesLoading" class="el-form-item__tip">{{ $t('settings.noRolesAvailable') }}</div>
        </el-form-item>

        <el-form-item v-if="editingUser" :label="$t('settings.invitationQuota')">
          <el-input-number v-model="userForm.invitation_quota" :min="0" :max="100" />
          <div class="el-form-item__tip">{{ $t('settings.invitationQuotaHint') }}</div>
        </el-form-item>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item :label="$t('settings.gender')">
              <el-select v-model="userForm.gender" clearable>
                <el-option label="" value="" />
                <el-option label="male" value="male">{{ $t('settings.genderMale') }}</el-option>
                <el-option label="female" value="female">{{ $t('settings.genderFemale') }}</el-option>
                <el-option label="other" value="other">{{ $t('settings.genderOther') }}</el-option>
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="$t('settings.birthday')">
              <el-date-picker v-model="userForm.birthday" type="date" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item :label="$t('settings.occupation')">
              <el-input v-model="userForm.occupation" :placeholder="$t('settings.occupationPlaceholder')" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="$t('settings.location')">
              <el-input v-model="userForm.location" :placeholder="$t('settings.locationPlaceholder')" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item :label="$t('settings.userAvatar')">
          <div class="avatar-upload">
            <div class="avatar-preview" :style="userForm.avatar ? { backgroundImage: `url(${userForm.avatar})` } : {}">
              <span v-if="!userForm.avatar">👤</span>
            </div>
            <div class="avatar-actions">
              <input type="file" accept="image/*" ref="userAvatarInput" @change="handleUserAvatarUpload" style="display: none" />
              <el-button size="small" @click="userAvatarInput?.click()">{{ $t('settings.uploadAvatar') }}</el-button>
              <el-button v-if="userForm.avatar" size="small" type="danger" @click="userForm.avatar = ''">{{ $t('common.delete') }}</el-button>
            </div>
          </div>
        </el-form-item>

        <el-divider v-if="editingUser">{{ $t('settings.resetPassword') }}</el-divider>

        <el-form-item v-if="editingUser" :label="$t('settings.newPassword')">
          <el-input v-model="userForm.newPassword" type="password" :placeholder="$t('settings.newPasswordPlaceholder')" show-password>
            <template #append>
              <el-button :disabled="!userForm.newPassword || userForm.newPassword.length < 6" @click="handleResetPassword">{{ $t('settings.resetPasswordBtn') }}</el-button>
            </template>
          </el-input>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button v-if="editingUser" type="danger" @click="confirmDeleteUserFromDialog">{{ $t('common.delete') }}</el-button>
        <el-button @click="closeUserDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!isUserFormValid" @click="saveUser">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
    <!-- 角色编辑对话框 -->
    <el-dialog
      v-model="showRoleDialog"
      :title="$t('settings.editRole')"
      width="500px"
    >
      <el-form label-width="100px">
        <el-form-item :label="$t('settings.roleMark')">
          <el-input
            v-model="roleForm.mark"
            disabled
            :placeholder="$t('settings.roleMarkPlaceholder')"
          />
          <div class="el-form-item__tip">{{ $t('settings.roleMarkHint') }}</div>
        </el-form-item>
        <el-form-item :label="$t('settings.roleName')">
          <el-input
            v-model="roleForm.name"
            :placeholder="$t('settings.roleNamePlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="$t('settings.roleDescription')">
          <el-input
            v-model="roleForm.description"
            type="textarea"
            :rows="3"
            :placeholder="$t('settings.roleDescriptionPlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeRoleDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!isRoleFormValid" @click="saveRole">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { useToastStore } from '@/stores/toast'
import { compressSmallAvatar } from '@/utils/imageCompress'
import { userApi, roleApi } from '@/api/services'
import type { UserListItem, CreateUserRequest, UpdateUserRequest, Role, Permission, ExpertSimple, UpdateRoleRequest } from '@/types'
import OrganizationTab from '@/components/settings/OrganizationTab.vue'
import SystemConfigTab from '@/components/settings/SystemConfigTab.vue'
import InvitationTab from '@/components/settings/InvitationTab.vue'
import ProfileSecurityTab from '@/components/settings/ProfileSecurityTab.vue'
import ModelProviderTab from '@/components/settings/ModelProviderTab.vue'
import ExpertSettingsTab from '@/components/settings/ExpertSettingsTab.vue'
import ResidentProcessesTab from '@/components/settings/ResidentProcessesTab.vue'
import AttachmentTab from '@/components/settings/AttachmentTab.vue'
import McpTab from '@/components/settings/McpTab.vue'
import AppManagementTab from '@/components/settings/AppManagementTab.vue'
import AppClockStatusTab from '@/components/settings/AppClockStatusTab.vue'
import Pagination from '@/components/Pagination.vue'
import packageInfo from '../../package.json'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const toast = useToastStore()

// 应用版本号
const appVersion = computed(() => packageInfo.version)

// 根据路由确定当前分组
const currentGroup = computed(() => {
  let group = route.meta?.settingsGroup as string | undefined
  if (!group) {
    const path = route.path
    if (path.startsWith('/system')) group = 'system'
    else if (path.startsWith('/organization')) group = 'organization'
    else group = 'personal'
  }
  return group
})

// 菜单项配置（按分组）
const organizationMenuItems = [
  { key: 'user', label: t('settings.userManagement'), route: '/organization/users' },
  { key: 'role', label: t('settings.roleManagement'), route: '/organization/roles' },
  { key: 'organization', label: t('settings.organizationManagement'), route: '/organization/departments' },
]

const personalMenuItems = [
  { key: 'profile', label: t('settings.profile'), route: '/personal/profile' },
  { key: 'invitation', label: t('settings.invitation'), route: '/personal/invitation' },
  { key: 'about', label: t('settings.about'), route: '/personal/about' },
]

const systemMenuItems = [
  { key: 'model', label: t('settings.modelAndProvider'), route: '/system/models' },
  { key: 'expert', label: t('settings.expertSettings'), route: '/system/experts' },
  { key: 'resident', label: t('settings.residentProcesses'), route: '/system/resident' },
  { key: 'attachment', label: t('settings.attachmentManagement'), route: '/system/attachments' },
  { key: 'mcp', label: t('settings.mcp.management'), route: '/system/mcp' },
  { key: 'apps', label: t('settings.appManagement.management'), route: '/system/apps' },
  { key: 'appClock', label: t('appClock.statusPanel'), route: '/system/app-clock' },
  { key: 'system', label: t('settings.systemConfig'), route: '/system/config' },
]

// 当前分组的菜单项
const currentMenuItems = computed(() => {
  let items: { key: string; label: string; route: string }[]

  if (currentGroup.value === 'organization') {
    items = organizationMenuItems
  } else if (currentGroup.value === 'system') {
    items = systemMenuItems
  } else {
    items = personalMenuItems
  }

  if (currentGroup.value === 'organization') {
    return items.filter(item => {
      if (item.key === 'role') return userStore.canManageRoles
      if (item.key === 'user' || item.key === 'organization') return userStore.isAdmin
      return true
    })
  }

  return items
})

// 从路由 meta 读取 activeTab
const getTabFromRoute = (): string => {
  const tab = route.meta?.settingsTab as string | undefined
  if (tab) return tab
  const items = currentMenuItems.value
  return items?.[0]?.key ?? 'profile'
}

const activeTab = computed({
  get: () => getTabFromRoute(),
  set: (key: string) => {
      const items = currentMenuItems.value
      const item = items?.find(i => i.key === key)
      if (item) {
        router.push(item.route)
      }
  },
})

const sidebarCollapsed = ref(false)

const handleMenuSelect = (index: string) => {
  const items = currentMenuItems.value
  const item = items?.find(i => i.key === index)
  if (item) {
    router.push(item.route)
  }
}

// 是否为管理员
const isAdmin = computed(() => userStore.isAdmin)
const canManageRoles = computed(() => userStore.canManageRoles)

// 用户管理状态
const usersList = ref<UserListItem[]>([])
const usersLoading = ref(false)
const userSearchQuery = ref('')
const userPage = ref(1)
const userTotalPages = ref(1)
const USER_PAGE_SIZE = 10

// 用户对话框
const showUserDialog = ref(false)
const editingUser = ref<UserListItem | null>(null)
const userForm = reactive({
  username: '',
  email: '',
  password: '',
  nickname: '',
  gender: '',
  birthday: '',
  occupation: '',
  location: '',
  status: 'active' as 'active' | 'inactive' | 'banned',
  avatar: '',
  newPassword: '',
  selectedRoleIds: [] as string[],
  invitation_quota: 1,
})

// 角色列表
const rolesList = ref<import('@/types').Role[]>([])
const rolesLoading = ref(false)

// 用户头像上传 ref
const userAvatarInput = ref<HTMLInputElement | null>(null)

// 角色管理状态
const selectedRole = ref<Role | null>(null)
const roleSubTab = ref<'permissions' | 'experts'>('permissions')
const allPermissions = ref<Permission[]>([])
const allExperts = ref<ExpertSimple[]>([])
const rolePermissionIds = ref<string[]>([])
const roleExpertIds = ref<string[]>([])
const rolePermissionsLoading = ref(false)
const roleExpertsLoading = ref(false)
const rolePermissionsChanged = ref(false)
const roleExpertsChanged = ref(false)
const isAdminRole = ref(false)  // 当前选中角色是否为管理员角色

// 角色编辑对话框
const showRoleDialog = ref(false)
const editingRole = ref<Role | null>(null)
const roleForm = reactive({
  mark: '',   // 角色标识符（不可变）
  name: '',   // 显示名称（可编辑）
  description: '',
})

// 角色表单验证
const isRoleFormValid = computed(() => {
  return roleForm.name?.trim()
})

// 用户表单验证
const isUserFormValid = computed(() => {
  if (!userForm.username.trim() || !userForm.email.trim()) {
    return false
  }
  // 新增用户时需要密码
  if (!editingUser.value && (!userForm.password || userForm.password.length < 6)) {
    return false
  }
  // 验证邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(userForm.email)) {
    return false
  }
  return true
})

// 加载用户列表
const loadUsers = async () => {
  usersLoading.value = true
  try {
    const response = await userApi.getUsers({
      page: userPage.value,
      size: USER_PAGE_SIZE,
      search: userSearchQuery.value || undefined,
    })
    usersList.value = response.items
    userTotalPages.value = response.pages
  } catch (err) {
    console.error('加载用户列表失败:', err)
    toast.error(t('settings.loadUsersFailed'))
  } finally {
    usersLoading.value = false
  }
}

// 用户搜索防抖
let userSearchTimeout: ReturnType<typeof setTimeout> | null = null
const handleUserSearch = () => {
  if (userSearchTimeout) {
    clearTimeout(userSearchTimeout)
  }
  userSearchTimeout = setTimeout(() => {
    userPage.value = 1
    loadUsers()
  }, 300)
}

// 加载角色列表
const loadRoles = async () => {
  rolesLoading.value = true
  try {
    const roles = await userApi.getRoles()
    rolesList.value = roles
  } catch (err) {
    console.error('加载角色列表失败:', err)
  } finally {
    rolesLoading.value = false
  }
}

// 打开用户对话框
const openUserDialog = async (user?: UserListItem) => {
  // 加载角色列表
  await loadRoles()
  
  if (user) {
    editingUser.value = user
    userForm.username = user.username
    userForm.email = user.email
    userForm.password = ''
    userForm.nickname = user.nickname || ''
    userForm.gender = user.gender || ''
    userForm.birthday = user.birthday || ''
    userForm.occupation = user.occupation || ''
    userForm.location = user.location || ''
    userForm.status = user.status
    userForm.avatar = user.avatar || ''
    userForm.newPassword = ''
    userForm.invitation_quota = user.invitation_quota ?? 1
    // 设置用户当前角色：根据角色标识符(mark)找到对应的角色ID
    if (user.roles && user.roles.length > 0) {
      const roleIds = rolesList.value
        .filter(r => user.roles!.includes(r.mark))
        .map(r => r.id)
      userForm.selectedRoleIds = roleIds
    } else {
      userForm.selectedRoleIds = []
    }
  } else {
    editingUser.value = null
    userForm.username = ''
    userForm.email = ''
    userForm.password = ''
    userForm.nickname = ''
    userForm.gender = ''
    userForm.birthday = ''
    userForm.occupation = ''
    userForm.location = ''
    userForm.status = 'active'
    userForm.avatar = ''
    userForm.newPassword = ''
    userForm.selectedRoleIds = []
    userForm.invitation_quota = 1
  }
  showUserDialog.value = true
}

// 关闭用户对话框
const closeUserDialog = () => {
  showUserDialog.value = false
  editingUser.value = null
}

// 保存用户
const saveUser = async () => {
  try {
    if (editingUser.value) {
      // 更新用户
      const updateData: UpdateUserRequest = {
        username: userForm.username,
        email: userForm.email,
        nickname: userForm.nickname,
        gender: userForm.gender as import('@/types').UserGender || undefined,
        birthday: userForm.birthday || undefined,
        occupation: userForm.occupation || undefined,
        location: userForm.location || undefined,
        status: userForm.status,
        avatar: userForm.avatar || undefined,
      }
      await userApi.updateUser(editingUser.value.id, updateData)
      // 更新用户角色
      await userApi.updateUserRoles(editingUser.value.id, { roleIds: userForm.selectedRoleIds })
      // 更新用户邀请配额
      await userApi.updateInvitationQuota(editingUser.value.id, userForm.invitation_quota)
    } else {
      // 创建用户
      const createData: CreateUserRequest = {
        username: userForm.username,
        email: userForm.email,
        password: userForm.password,
        nickname: userForm.nickname || undefined,
        gender: userForm.gender as import('@/types').UserGender || undefined,
        birthday: userForm.birthday || undefined,
        occupation: userForm.occupation || undefined,
        location: userForm.location || undefined,
        status: userForm.status,
        avatar: userForm.avatar || undefined,
      }
      const newUser = await userApi.createUser(createData)
      // 为新用户设置角色
      if (newUser && newUser.id && userForm.selectedRoleIds.length > 0) {
        await userApi.updateUserRoles(newUser.id, { roleIds: userForm.selectedRoleIds })
      }
      // 为新用户设置邀请配额
      if (newUser && newUser.id) {
        await userApi.updateInvitationQuota(newUser.id, userForm.invitation_quota)
      }
    }
    closeUserDialog()
    loadUsers()
    toast.success(t('settings.saveUserSuccess'))
  } catch (err) {
    console.error('保存用户失败:', err)
    toast.error(t('settings.saveUserFailed'))
  }
}

// 确认删除用户
const confirmDeleteUser = async (user: UserListItem) => {
  try {
    await ElMessageBox.confirm(
      t('settings.deleteUserConfirm', { name: user.nickname || user.username }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    await userApi.deleteUser(user.id)
    loadUsers()
  } catch (err) {
    if (err !== 'cancel') {
      console.error('删除用户失败:', err)
      toast.error(t('settings.deleteUserFailed'))
    }
  }
}

// 从对话框内确认删除
const confirmDeleteUserFromDialog = async () => {
  if (!editingUser.value) return
  
  try {
    await ElMessageBox.confirm(
      t('settings.deleteUserConfirm', { name: editingUser.value.nickname || editingUser.value.username }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    await userApi.deleteUser(editingUser.value.id)
    closeUserDialog()
    loadUsers()
  } catch (err) {
    if (err !== 'cancel') {
      console.error('删除用户失败:', err)
      toast.error(t('settings.deleteUserFailed'))
    }
  }
}

// 重置密码
const handleResetPassword = async () => {
  if (!editingUser.value || !userForm.newPassword || userForm.newPassword.length < 6) return
  
  try {
    await userApi.resetPassword(editingUser.value.id, { password: userForm.newPassword })
    userForm.newPassword = ''
    toast.success(t('settings.resetPasswordSuccess'))
  } catch (err) {
    console.error('重置密码失败:', err)
    toast.error(t('settings.resetPasswordFailed'))
  }
}

// 用户头像上传
const handleUserAvatarUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  
  try {
    // 使用小头像压缩方法
    const result = await compressSmallAvatar(file)
    userForm.avatar = result.base64
    console.log(`用户头像压缩: ${Math.round(result.originalSize / 1024)}KB → ${Math.round(result.compressedSize / 1024)}KB`)
  } catch (err) {
    console.error('压缩用户头像失败:', err)
    toast.error(err instanceof Error ? err.message : t('settings.imageProcessFailed'))
  }
  input.value = ''
}

// 处理用户名输入：普通用户名只保留字母/数字/下划线，输入含 @ 时视为邮箱格式用户名，允许邮箱字符
const handleUsernameInput = (event: Event) => {
  const input = event.target as HTMLInputElement
  let value = input.value
  if (value.includes('@')) {
    // 邮箱格式用户名：允许邮箱常见字符，最大长度 32（与后端 username VARCHAR(32) 对齐）
    value = value.replace(/[^a-zA-Z0-9._@+-]/g, '')
    if (value.length > 32) {
      value = value.substring(0, 32)
    }
  } else {
    // 普通用户名：只保留字母、数字、下划线
    value = value.replace(/[^a-zA-Z0-9_]/g, '')
    // 确保第一个字符是字母（如果不是，则删除第一个字符）
    const firstChar = value[0]
    if (firstChar && !/^[a-zA-Z]$/.test(firstChar)) {
      value = value.substring(1)
    }
    // 限制最大长度为16
    if (value.length > 16) {
      value = value.substring(0, 16)
    }
  }
  // 更新表单值
  userForm.username = value
  // 如果值被修改过，更新输入框显示
  if (input.value !== value) {
    input.value = value
  }
}

// 监听用户分页变化
watch(userPage, () => {
  loadUsers()
})

// 监听用户管理 tab 切换
watch(activeTab, (newTab) => {
  if (newTab === 'user' && usersList.value.length === 0) {
    loadUsers()
  }
  if (newTab === 'role' && rolesList.value.length === 0) {
    loadRolesForManagement()
  }
  if (newTab === 'role' && allPermissions.value.length === 0) {
    loadAllPermissions()
  }
  if (newTab === 'role' && allExperts.value.length === 0) {
    loadAllExperts()
  }
}, { immediate: true })

// 监听设置组切换（路由已处理 redirect，此处仅保留数据加载逻辑）

// =====================
// 角色管理方法
// =====================

// 加载角色列表（用于角色管理）
const loadRolesForManagement = async () => {
  rolesLoading.value = true
  try {
    const roles = await roleApi.getRoles()
    rolesList.value = roles
  } catch (err) {
    console.error('加载角色列表失败:', err)
    toast.error(t('settings.loadRolesFailed'))
  } finally {
    rolesLoading.value = false
  }
}

// 加载所有权限列表
const loadAllPermissions = async () => {
  try {
    const permissions = await roleApi.getAllPermissions()
    allPermissions.value = permissions
  } catch (err) {
    console.error('加载权限列表失败:', err)
    toast.error(t('settings.loadPermissionsFailed'))
  }
}

// 加载所有专家列表
const loadAllExperts = async () => {
  try {
    const experts = await roleApi.getAllExperts()
    allExperts.value = experts
  } catch (err) {
    console.error('加载专家列表失败:', err)
    toast.error(t('settings.loadExpertsFailed'))
  }
}

// 选择角色
const selectRole = async (role: Role) => {
  selectedRole.value = role
  roleSubTab.value = 'permissions'
  
  // 加载角色的权限配置
  rolePermissionsLoading.value = true
  roleExpertsLoading.value = true
  
  try {
    const [permissionsData, expertsData] = await Promise.all([
      roleApi.getRolePermissions(role.id),
      roleApi.getRoleExperts(role.id),
    ])
    rolePermissionIds.value = permissionsData.permission_ids || []
    roleExpertIds.value = expertsData.expert_ids || []
    // 判断是否为管理员角色（expertsData 接口返回 is_admin）
    isAdminRole.value = expertsData.is_admin || false
    rolePermissionsChanged.value = false
    roleExpertsChanged.value = false
  } catch (err) {
    console.error('加载角色配置失败:', err)
  } finally {
    rolePermissionsLoading.value = false
    roleExpertsLoading.value = false
  }
}

// 打开角色编辑对话框
const openRoleDialog = (role: Role) => {
  editingRole.value = role
  roleForm.mark = role.mark
  roleForm.name = role.name
  roleForm.description = role.description || ''
  showRoleDialog.value = true
}

// 关闭角色编辑对话框
const closeRoleDialog = () => {
  showRoleDialog.value = false
  editingRole.value = null
}

// 保存角色基本信息
const saveRole = async () => {
  if (!editingRole.value) return
  
  try {
    const updateData: UpdateRoleRequest = {
      name: roleForm.name,
      description: roleForm.description,
    }
    const updatedRole = await roleApi.updateRole(editingRole.value.id, updateData)
    
    // 更新本地列表
    const index = rolesList.value.findIndex(r => r.id === editingRole.value!.id)
    if (index !== -1) {
      rolesList.value[index] = updatedRole
    }
    
    // 更新选中角色
    if (selectedRole.value?.id === editingRole.value.id) {
      selectedRole.value = updatedRole
    }
    
    closeRoleDialog()
    toast.success(t('settings.updateRoleSuccess'))
  } catch (err) {
    console.error('保存角色失败:', err)
    const errorMsg = err instanceof Error ? err.message : t('settings.saveRoleFailed')
    toast.error(errorMsg)
  }
}

// 保存角色权限配置
const saveRolePermissions = async () => {
  if (!selectedRole.value) return
  
  try {
    await roleApi.updateRolePermissions(selectedRole.value.id, {
      permission_ids: rolePermissionIds.value,
    })
    rolePermissionsChanged.value = false
    toast.success(t('settings.savePermissionsSuccess'))
  } catch (err) {
    console.error('保存权限配置失败:', err)
    toast.error(t('settings.savePermissionsFailed'))
  }
}

// 保存角色专家访问权限
const saveRoleExperts = async () => {
  if (!selectedRole.value) return
  
  try {
    await roleApi.updateRoleExperts(selectedRole.value.id, {
      expert_ids: roleExpertIds.value,
    })
    roleExpertsChanged.value = false
    toast.success(t('settings.saveExpertsSuccess'))
  } catch (err) {
    console.error('保存专家访问权限失败:', err)
    toast.error(t('settings.saveExpertsFailed'))
  }
}

onMounted(() => {
  // 加载权限列表和专家列表（用于角色管理）
  if (canManageRoles.value) {
    loadAllPermissions()
    loadAllExperts()
  }
})
</script>

<style scoped>
.settings-view {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: calc(100vh - 64px);
}

/* Element Plus el-menu */
.settings-sidebar.el-menu {
  flex: 0 0 220px;
}

.settings-sidebar.el-menu--collapse {
  flex-basis: 64px;
}

.settings-main {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  transition: padding 0.3s ease;
}

.settings-section {
  padding: 24px;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 12px;
}

/* 模型和提供商合并区域 */
.model-provider-section {
  padding: 0;
  overflow: hidden;
}

.split-panel {
  display: flex;
  min-height: 500px;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary, #333);
}



.badge {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 4px;
  font-weight: 500;
  flex-shrink: 0;
}

.badge.inactive {
  background: var(--error-bg, #ffebee);
  color: var(--error-color, #c62828);
}

/* 空状态和加载状态 */
.loading-state,
.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary, #666);
  font-size: 14px;
}

/* 专家设置区域 */
.expert-section {
  padding: 0;
  overflow: hidden;
}

.expert-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.expert-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.expert-intro {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin: 0 0 8px 0;
  line-height: 1.5;
}

/* About */
.about-content {
  text-align: center;
}

.app-name {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--text-primary, #333);
}

.app-version {
  font-size: 14px;
  color: var(--text-secondary, #666);
  margin: 0 0 16px 0;
}

.app-description {
  font-size: 14px;
  color: var(--text-secondary, #666);
  margin: 0;
}

/* 响应式 */
@media (max-width: 768px) {
  .settings-view {
    flex-direction: column;
    min-height: auto;
  }

  .settings-sidebar {
    flex: none;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-color, #e0e0e0);
  }

  .settings-sidebar.el-menu--collapse {
    flex-basis: auto;
  }

  .settings-main {
    padding: 16px;
  }

  .split-panel {
    flex-direction: column;
  }

}

.avatar-upload {
  display: flex;
  align-items: center;
  gap: 16px;
}

.avatar-preview {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--secondary-bg, #f8f9fa);
  border: 2px dashed var(--border-color, #e0e0e0);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
}

.avatar-preview.large {
  width: 100px;
  height: 100px;
  border-radius: 12px;
  font-size: 36px;
}

.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 用户管理区域 */
.user-section {
  padding: 0;
  overflow: hidden;
}

.user-section .panel-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.user-search {
  padding: 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.user-list-container {
  display: flex;
  flex-direction: column;
  min-height: 400px;
}

.user-list {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  max-height: calc(100vh - 320px);
}

.user-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  margin-bottom: 12px;
  border-radius: 10px;
  background: var(--secondary-bg, #f8f9fa);
  border: 1px solid transparent;
  transition: all 0.2s;
}

.user-item:hover {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--border-color, #e0e0e0);
}

.user-item.inactive {
  opacity: 0.6;
}

.user-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--border-color, #e0e0e0);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
  overflow: hidden;
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-info {
  flex: 1;
  min-width: 0;
}

.user-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.user-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.user-roles {
  font-size: 12px;
  color: var(--primary-color, #2196f3);
  background: var(--primary-light, #e3f2fd);
  padding: 2px 8px;
  border-radius: 4px;
}

.user-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--text-secondary, #666);
}

.user-email {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-invitation-quota {
  font-size: 12px;
  color: var(--primary-color, #2196f3);
  background: var(--primary-light, #e3f2fd);
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}

.user-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 响应式调整 - 用户管理 */
@media (max-width: 768px) {
  .user-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .user-actions {
    align-self: flex-end;
    margin-top: 8px;
  }

  .user-meta {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
}

/* 角色管理区域 */
.role-section {
  padding: 0;
  overflow: hidden;
}

.role-list-panel {
  flex: 0 0 280px;
  border-right: 1px solid var(--border-color, #e0e0e0);
  background: var(--secondary-bg, #f8f9fa);
}

.role-detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--card-bg, #fff);
}

.role-list-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.role-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.role-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: 8px;
  background: var(--card-bg, #fff);
  border: 1px solid transparent;
  transition: all 0.2s;
}

.role-item:hover {
  background: var(--hover-bg, #e8e8e8);
}

.role-item.active {
  background: var(--primary-light, #e3f2fd);
  border-color: var(--primary-color, #2196f3);
}

.role-item.system {
  opacity: 0.8;
}

.role-name-btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  padding: 4px;
  min-width: 0;
}

.role-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge.system {
  background: var(--secondary-bg, #e8e8e8);
  color: var(--text-secondary, #666);
}

.select-role-hint {
  color: var(--text-tertiary, #999);
  font-style: italic;
  padding: 60px 40px;
}

.permissions-list,
.experts-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  min-height: 0;
  max-height: calc(100vh - 320px);
}

.permission-info,
.expert-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.permission-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.permission-desc {
  font-size: 12px;
  color: var(--text-secondary, #666);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}


.permissions-count,
.experts-count {
  font-size: 13px;
  color: var(--text-secondary, #666);
}

/* 响应式调整 - 角色管理 */
@media (max-width: 768px) {
  .role-list-panel {
    flex: none;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-color, #e0e0e0);
    max-height: 250px;
  }

  .role-detail-panel {
    flex: none;
    min-height: 300px;
  }
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
</style>
