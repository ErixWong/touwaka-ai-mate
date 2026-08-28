<template>
  <div class="organization-section">
    <div class="split-panel">
      <!-- 左：部门树 -->
      <div class="panel department-panel">
        <div class="panel-header">
          <h3 class="panel-title">{{ $t('settings.departmentManagement') }}</h3>
          <el-button size="small" type="primary" :icon="Plus" @click="openDepartmentDialog()">
            {{ $t('settings.addDepartment') }}
          </el-button>
        </div>

        <div v-if="loading" class="loading-state">{{ $t('common.loading') }}</div>
        <el-empty
          v-else-if="departmentTree.length === 0"
          class="empty-state"
          :description="$t('settings.noDepartments')"
          :image-size="60"
        />
        <el-tree
          v-else
          class="department-tree"
          :data="departmentTree"
          :props="{ label: 'name', children: 'children' }"
          node-key="id"
          highlight-current
          :current-node-key="selectedDepartment?.id"
          :expand-on-click-node="false"
          :default-expand-all="true"
          @current-change="handleTreeSelect"
        >
          <template #default="{ data }">
            <div class="tree-node" :class="{ selected: data.id === selectedDepartment?.id }">
              <span class="tree-node-label">
                <el-icon class="dept-icon"><OfficeBuilding /></el-icon>
                <span class="tree-node-name">{{ data.name }}</span>
                <el-tag
                  v-if="data.children?.length"
                  size="small"
                  type="info"
                  effect="plain"
                  round
                  class="dept-child-count"
                >
                  {{ data.children.length }}
                </el-tag>
              </span>
              <span class="tree-node-actions" @click.stop>
                <el-button
                  size="small"
                  text
                  :icon="Plus"
                  :title="$t('settings.addChildDepartment')"
                  @click="openDepartmentDialog(undefined, data.id)"
                />
                <el-button
                  size="small"
                  text
                  type="primary"
                  :icon="Edit"
                  :title="$t('common.edit')"
                  @click="openDepartmentDialog(data)"
                />
                <el-button
                  size="small"
                  text
                  type="danger"
                  :icon="Delete"
                  :title="$t('common.delete')"
                  @click="deleteDepartment(data)"
                />
              </span>
            </div>
          </template>
        </el-tree>
      </div>

      <!-- 右：职位面板 -->
      <div class="panel position-panel">
        <div class="panel-header">
          <h3 class="panel-title">
            {{ selectedDepartment ? $t('settings.positionsOfDepartment', { name: selectedDepartment.name }) : $t('settings.positionManagement') }}
          </h3>
          <el-button v-if="selectedDepartment" size="small" type="primary" :icon="Plus" @click="openPositionDialog()">
            {{ $t('settings.addPosition') }}
          </el-button>
        </div>

        <el-empty
          v-if="!selectedDepartment"
          class="empty-state"
          :description="$t('settings.selectDepartmentHint')"
          :image-size="60"
        />
        <div v-else-if="positionLoading" class="loading-state">{{ $t('common.loading') }}</div>
        <el-empty
          v-else-if="positions.length === 0"
          class="empty-state"
          :description="$t('settings.noPositions')"
          :image-size="60"
        />
        <div v-else class="position-list">
          <div v-for="position in positions" :key="position.id" class="position-item">
            <div class="position-info">
              <span class="position-name">{{ position.name }}</span>
              <el-tag v-if="position.is_manager" type="warning" size="small" effect="light">{{ $t('settings.manager') }}</el-tag>
              <el-tag v-if="position.members?.length" type="success" size="small" effect="plain" round>
                {{ $t('settings.positionMemberCount', { count: position.members.length }) }}
              </el-tag>
            </div>

            <el-select
              class="position-user-select"
              :model-value="getPositionUserId(position.id)"
              :placeholder="$t('settings.selectUser')"
              filterable
              remote
              clearable
              popper-class="user-select-dropdown"
              :remote-method="handleRemoteSearch"
              :loading="userLoading"
              @visible-change="handleSelectVisible"
              @change="(uid: string | undefined) => handlePositionUserChange(position, uid)"
            >
              <el-option
                v-for="u in users"
                :key="u.id"
                :value="u.id"
                :label="u.nickname || u.username"
              >
                <div class="user-option">
                  <el-avatar :size="20" :src="u.avatar || undefined">
                    {{ (u.nickname || u.username || '?').charAt(0).toUpperCase() }}
                  </el-avatar>
                  <span class="user-option-name">{{ u.nickname || u.username }}</span>
                  <span v-if="u.nickname" class="user-option-username">@{{ u.username }}</span>
                </div>
              </el-option>
              <template #footer>
                <div v-if="userLoading" class="select-dropdown-footer">
                  {{ $t('common.loading') }}
                </div>
                <div v-else-if="!noMoreUsers" class="select-dropdown-footer" @click="loadUsers()">
                  {{ $t('settings.loadMoreUsers') }}
                </div>
              </template>
            </el-select>

            <div class="position-actions">
              <el-button size="small" :icon="Edit" @click="openPositionDialog(position)">{{ $t('common.edit') }}</el-button>
              <el-button size="small" type="danger" :icon="Delete" @click="deletePosition(position)">{{ $t('common.delete') }}</el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 部门弹窗 -->
    <el-dialog v-model="showDepartmentDialog" :title="editingDepartment ? $t('settings.editDepartment') : $t('settings.addDepartment')" width="420px">
      <el-form label-width="100px">
        <el-form-item :label="$t('settings.departmentName')">
          <el-input v-model="departmentForm.name" :placeholder="$t('settings.departmentNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('settings.departmentDescription')">
          <el-input v-model="departmentForm.description" type="textarea" :rows="3" :placeholder="$t('settings.departmentDescriptionPlaceholder')" />
        </el-form-item>
        <el-form-item v-if="editingDepartment" :label="$t('settings.parentDepartment')">
          <el-select v-model="departmentForm.parent_id" clearable :placeholder="$t('settings.noParent')">
            <el-option v-for="dept in availableParentDepartments" :key="dept.id" :value="dept.id" :label="dept.name" :disabled="dept.id === editingDepartment?.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeDepartmentDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!departmentForm.name" @click="saveDepartment">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- 职位弹窗 -->
    <el-dialog v-model="showPositionDialog" :title="editingPosition ? $t('settings.editPosition') : $t('settings.addPosition')" width="420px">
      <el-form label-width="100px">
        <el-form-item :label="$t('settings.positionName')">
          <el-input v-model="positionForm.name" :placeholder="$t('settings.positionNamePlaceholder')" />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="positionForm.is_manager">{{ $t('settings.isManager') }}</el-checkbox>
        </el-form-item>
        <el-form-item :label="$t('settings.positionDescription')">
          <el-input v-model="positionForm.description" type="textarea" :rows="3" :placeholder="$t('settings.positionDescriptionPlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closePositionDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!positionForm.name" @click="savePosition">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, OfficeBuilding } from '@element-plus/icons-vue'
import { departmentApi, positionApi, organizationApi, userApi } from '@/api/services'
import type { Department, Position, UserListItem } from '@/types'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()

const loading = ref(false)
const positionLoading = ref(false)
const departmentTree = ref<Department[]>([])
const selectedDepartment = ref<Department | null>(null)
const positions = ref<Position[]>([])
const positionUserMap = ref<Map<string, string>>(new Map())

// 用户列表（远程分页加载，突破单次 100 条限制）
const users = ref<UserListItem[]>([])
const USER_PAGE_SIZE = 50
const userPage = ref(1)
const userTotal = ref(0)
const userSearch = ref('')
const userLoading = ref(false)
const noMoreUsers = computed(() => userTotal.value > 0 && users.value.length >= userTotal.value)

function getApiErrorMessage(cause: unknown, fallback: string) {
  if (typeof cause === 'object' && cause !== null && 'response' in cause) {
    const response = Reflect.get(cause, 'response')
    if (typeof response === 'object' && response !== null && 'data' in response) {
      const data = Reflect.get(response, 'data')
      if (typeof data === 'object' && data !== null && 'message' in data) {
        const message = Reflect.get(data, 'message')
        if (typeof message === 'string' && message) return message
      }
    }
  }
  return cause instanceof Error ? cause.message : fallback
}

const showDepartmentDialog = ref(false)
const editingDepartment = ref<Department | null>(null)
const departmentForm = reactive({ name: '', description: '', parent_id: '' })

const showPositionDialog = ref(false)
const editingPosition = ref<Position | null>(null)
const positionForm = reactive({ name: '', is_manager: false, description: '' })

const availableParentDepartments = computed(() => {
  const flatten = (items: Department[], result: Department[] = []): Department[] => {
    for (const item of items) {
      result.push(item)
      if (item.children?.length) flatten(item.children, result)
    }
    return result
  }
  return flatten(departmentTree.value)
})

const loadDepartmentTree = async () => {
  loading.value = true
  try {
    departmentTree.value = await departmentApi.getDepartmentTree()
  } catch (error) {
    console.error('Failed to load department tree:', error)
    toast.error(t('error.loadFailed'))
  } finally {
    loading.value = false
  }
}

const loadUsers = async (reset = false) => {
  if (userLoading.value) return
  if (!reset && noMoreUsers.value) return
  userLoading.value = true
  try {
    const page = reset ? 1 : userPage.value + 1
    const response = await userApi.getUsers({ page, size: USER_PAGE_SIZE, search: userSearch.value || undefined })
    const items = response.items || []
    if (reset) users.value = items
    else users.value.push(...items)
    userPage.value = page
    userTotal.value = response.pagination?.total ?? items.length
  } catch (error) {
    console.error('Failed to load users:', error)
    toast.error(t('error.loadFailed'))
  } finally {
    userLoading.value = false
  }
}

// remote 搜索：重置分页并携带关键字
const handleRemoteSearch = async (keyword: string) => {
  userSearch.value = keyword.trim()
  await loadUsers(true)
}

// 下拉打开/关闭：打开时绑定滚动加载，关闭时解绑
let scrollCleanup: (() => void) | null = null
const bindScrollLoad = (attempt = 0) => {
  // popper teleport 到 body，可能在 visible-change 后才渲染完成，重试绑定
  if (attempt > 20) return
  nextTick(() => {
    const wrap = document.querySelector('.user-select-dropdown .el-select-dropdown__wrap')
    if (!wrap) {
      setTimeout(() => bindScrollLoad(attempt + 1), 100)
      return
    }
    const onScroll = () => {
      const el = wrap as HTMLElement
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) loadUsers()
    }
    wrap.addEventListener('scroll', onScroll)
    scrollCleanup = () => wrap.removeEventListener('scroll', onScroll)
  })
}
const handleSelectVisible = (visible: boolean) => {
  if (visible) {
    bindScrollLoad()
  } else {
    scrollCleanup?.()
    scrollCleanup = null
  }
}

// 补拉已分配用户：刷新后保证 el-select 能显示名字而非原始 ID（已分配用户可能不在已加载分页内）
const ensureAssignedUsersLoaded = async () => {
  const missing = [...positionUserMap.value.values()].filter(uid => uid && !users.value.some(u => u.id === uid))
  for (const uid of missing) {
    try {
      const user = await userApi.getUser(uid)
      if (user) users.value.unshift(user)
    } catch (error) {
      console.error('Failed to load assigned user:', error)
    }
  }
}

const handleTreeSelect = async (data: Department | null) => {
  if (!data) return
  selectedDepartment.value = data
  await loadPositions(data.id)
}

const loadPositions = async (departmentId: string) => {
  positionLoading.value = true
  try {
    positions.value = await positionApi.getDepartmentPositions(departmentId)
    // 职位成员已由后端 LEFT JOIN 返回，直接填充本地映射（省去逐个调用 members API）
    positionUserMap.value = new Map()
    for (const position of positions.value) {
      const firstMember = position.members?.[0]
      if (firstMember) positionUserMap.value.set(position.id, firstMember.id)
    }
    await ensureAssignedUsersLoaded()
  } catch (error) {
    console.error('Failed to load positions:', error)
    toast.error(t('error.loadFailed'))
  } finally {
    positionLoading.value = false
  }
}

const openDepartmentDialog = (dept?: Department, parentId?: string) => {
  editingDepartment.value = dept || null
  departmentForm.name = dept?.name || ''
  departmentForm.description = dept?.description || ''
  departmentForm.parent_id = parentId || dept?.parent_id || ''
  showDepartmentDialog.value = true
}

const closeDepartmentDialog = () => {
  showDepartmentDialog.value = false
  editingDepartment.value = null
  departmentForm.name = ''
  departmentForm.description = ''
  departmentForm.parent_id = ''
}

const saveDepartment = async () => {
  if (!departmentForm.name) return
  try {
    if (editingDepartment.value) {
      await departmentApi.updateDepartment(editingDepartment.value.id, { name: departmentForm.name, description: departmentForm.description })
    } else {
      await departmentApi.createDepartment({ name: departmentForm.name, parent_id: departmentForm.parent_id || undefined, description: departmentForm.description || undefined })
    }
    await loadDepartmentTree()
    closeDepartmentDialog()
  } catch (error) {
    console.error('Failed to save department:', error)
    toast.error(t('common.saveFailed'))
  }
}

const deleteDepartment = async (dept: Department) => {
  try {
    await ElMessageBox.confirm(t('settings.confirmDeleteDepartment'), t('common.confirm'), { type: 'warning' })
    await departmentApi.deleteDepartment(dept.id)
    if (selectedDepartment.value?.id === dept.id) {
      selectedDepartment.value = null
      positions.value = []
      positionUserMap.value = new Map()
    }
    await loadDepartmentTree()
  } catch (error: unknown) {
    if (error !== 'cancel') {
      console.error('Failed to delete department:', error)
      toast.error(getApiErrorMessage(error, t('common.deleteFailed')))
    }
  }
}

const openPositionDialog = (position?: Position) => {
  editingPosition.value = position || null
  positionForm.name = position?.name || ''
  positionForm.is_manager = position?.is_manager || false
  positionForm.description = position?.description || ''
  showPositionDialog.value = true
}

const closePositionDialog = () => {
  showPositionDialog.value = false
  editingPosition.value = null
  positionForm.name = ''
  positionForm.is_manager = false
  positionForm.description = ''
}

const savePosition = async () => {
  if (!positionForm.name || !selectedDepartment.value) return
  try {
    if (editingPosition.value) {
      await positionApi.updatePosition(editingPosition.value.id, { name: positionForm.name, is_manager: positionForm.is_manager, description: positionForm.description })
    } else {
      await positionApi.createPosition({ name: positionForm.name, department_id: selectedDepartment.value.id, is_manager: positionForm.is_manager, description: positionForm.description || undefined })
    }
    await loadPositions(selectedDepartment.value.id)
    closePositionDialog()
  } catch (error) {
    console.error('Failed to save position:', error)
    toast.error(t('common.saveFailed'))
  }
}

const deletePosition = async (position: Position) => {
  try {
    await ElMessageBox.confirm(t('settings.confirmDeletePosition'), t('common.confirm'), { type: 'warning' })
    await positionApi.deletePosition(position.id)
    await loadPositions(selectedDepartment.value!.id)
  } catch (error: unknown) {
    if (error !== 'cancel') {
      console.error('Failed to delete position:', error)
      toast.error(getApiErrorMessage(error, t('common.deleteFailed')))
    }
  }
}

const getPositionUserId = (positionId: string): string | undefined =>
  positionUserMap.value.get(positionId) || undefined

const handlePositionUserChange = async (position: Position, userId: string | undefined | null) => {
  try {
    if (userId) {
      positionUserMap.value.set(position.id, userId)
      // 本地同步成员（tag 即时更新，避免重新请求）
      position.members = [users.value.find(u => u.id === userId)].filter((u): u is UserListItem => !!u)
      await organizationApi.updateUserOrganization(userId, { department_id: selectedDepartment.value?.id || null, position_id: position.id })
    } else {
      // 清空选择：同步移除该用户在组织中的归属（仅删本地 map 不调 API 会"看起来没保存"）
      const currentUserId = positionUserMap.value.get(position.id)
      positionUserMap.value.delete(position.id)
      position.members = []
      if (currentUserId) {
        await organizationApi.updateUserOrganization(currentUserId, { department_id: null, position_id: null })
      }
    }
    toast.success(t('settings.assignSuccess'))
  } catch (error: unknown) {
    console.error('Failed to assign user to position:', error)
    toast.error(getApiErrorMessage(error, t('common.saveFailed')))
    // 回滚到服务端真实状态
    if (selectedDepartment.value) await loadPositions(selectedDepartment.value.id)
  }
}

onMounted(() => {
  loadDepartmentTree()
  loadUsers(true)
})

onUnmounted(() => {
  scrollCleanup?.()
  scrollCleanup = null
})
</script>

<style scoped>
.organization-section {
  height: 100%;
  display: flex;
}

.split-panel {
  display: flex;
  gap: 16px;
  width: 100%;
  height: calc(100vh - 250px);
  min-height: 420px;
}

.panel {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-primary);
}

.department-panel {
  flex: 0 0 300px;
  max-width: 320px;
}

.position-panel {
  flex: 1;
  min-width: 0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--text-secondary);
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

/* ── 部门树 ─────────────────────────── */
.department-tree {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.department-tree :deep(.el-tree-node__content) {
  height: 36px;
  border-radius: 6px;
}

.tree-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 4px;
}

.tree-node-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.dept-icon {
  color: var(--text-secondary);
  font-size: 15px;
  flex-shrink: 0;
}

.tree-node-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 选中态：文字主题色加粗 + 树自带高亮背景（highlight-current） */
.tree-node.selected .tree-node-name {
  color: var(--el-color-primary);
  font-weight: 600;
}

.dept-child-count {
  flex-shrink: 0;
}

.tree-node-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.2s;
  flex-shrink: 0;
}

.tree-node:hover .tree-node-actions,
.tree-node.selected .tree-node-actions {
  opacity: 1;
}

/* ── 职位列表 ───────────────────────── */
.position-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.position-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  transition: background-color 0.15s;
}

.position-item:last-child {
  border-bottom: none;
}

.position-item:hover {
  background: var(--bg-secondary);
}

.position-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.position-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.position-user-select {
  flex: 0 0 190px;
}

.user-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-option-name {
  font-size: 13px;
}

.user-option-username {
  color: var(--text-secondary);
  font-size: 12px;
}

.position-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* 下拉分页加载 footer */
.select-dropdown-footer {
  padding: 8px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  border-top: 1px solid var(--border-color);
  user-select: none;
}

.select-dropdown-footer:hover {
  color: var(--el-color-primary);
  background: var(--bg-secondary);
}
</style>
