<template>
  <div class="user-picker">
    <!-- 触发按钮 -->
    <button
      class="picker-trigger"
      :class="{ disabled, 'has-value': !!selectedUser }"
      @click="openModal"
      :disabled="disabled"
    >
      <template v-if="selectedUser">
        <span class="trigger-avatar">
          <img v-if="selectedUser.avatar" :src="selectedUser.avatar" :alt="selectedUser.nickname || selectedUser.username" />
          <span v-else class="avatar-text">
            {{ (selectedUser.nickname || selectedUser.username || '?').charAt(0).toUpperCase() }}
          </span>
        </span>
        <span class="trigger-text">{{ selectedUser.nickname || selectedUser.username }}</span>
      </template>
      <template v-else>
        <span class="trigger-text">{{ placeholder || $t('settings.selectUser') }}</span>
      </template>
    </button>

    <!-- Modal 弹窗 -->
    <Teleport to="body">
      <div v-if="showModal" class="user-picker-overlay" @click.self="closeModal">
        <div class="user-picker-modal">
          <div class="modal-header">
            <h3>{{ $t('settings.selectUser') }}</h3>
            <button class="close-btn" @click="closeModal">×</button>
          </div>

          <div class="modal-body">
            <!-- 搜索框 -->
            <div class="search-wrapper">
              <input
                ref="searchInputRef"
                v-model="searchQuery"
                type="text"
                class="search-input"
                :placeholder="$t('settings.searchUser')"
              />
            </div>

            <!-- 用户列表 -->
            <div class="user-list">
              <div v-if="loading" class="loading-state">
                {{ $t('common.loading') }}
              </div>

              <div v-else-if="filteredUsers.length === 0" class="empty-state">
                {{ searchQuery ? $t('settings.noUsersFound') : $t('settings.noUsers') }}
              </div>

              <template v-else>
                <div
                  v-for="user in filteredUsers"
                  :key="user.id"
                  class="user-item"
                  :class="{ selected: user.id === modelValue }"
                  @click="selectUser(user)"
                >
                  <div class="user-avatar">
                    <img v-if="user.avatar" :src="user.avatar" :alt="user.nickname || user.username" />
                    <span v-else class="avatar-placeholder">
                      {{ (user.nickname || user.username || '?').charAt(0).toUpperCase() }}
                    </span>
                  </div>
                  <div class="user-info">
                    <span class="user-name">{{ user.nickname || user.username }}</span>
                    <span v-if="user.nickname" class="user-username">@{{ user.username }}</span>
                  </div>
                  <span v-if="user.id === modelValue" class="check-icon">✓</span>
                </div>
              </template>
            </div>
          </div>

          <div class="modal-footer">
            <button v-if="modelValue" class="btn-clear" @click="clearSelection">
              {{ $t('common.none') }}
            </button>
            <button class="btn-cancel" @click="closeModal">
              {{ $t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { userApi } from '@/api/services'
import { useToastStore } from '@/stores/toast'
import type { UserListItem } from '@/types'

interface Props {
  modelValue?: string | null
  placeholder?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  placeholder: '',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [userId: string | null]
  'change': [user: UserListItem | null]
}>()

const { t } = useI18n()
const toast = useToastStore()

// 状态
const searchInputRef = ref<HTMLInputElement | null>(null)
const showModal = ref(false)
const searchQuery = ref('')
const loading = ref(false)
const users = ref<UserListItem[]>([])
const selectedUser = ref<UserListItem | null>(null)

// 过滤后的用户列表
const filteredUsers = computed(() => {
  if (!searchQuery.value) return users.value
  const query = searchQuery.value.toLowerCase()
  return users.value.filter(user =>
    user.username?.toLowerCase().includes(query) ||
    user.nickname?.toLowerCase().includes(query) ||
    user.email?.toLowerCase().includes(query)
  )
})

// 加载用户列表
const loadUsers = async () => {
  loading.value = true
  try {
    const response = await userApi.getUsers({ size: 100 })
    users.value = response.items || []
    
    // 如果有选中值，找到对应的用户
    if (props.modelValue) {
      selectedUser.value = users.value.find(u => u.id === props.modelValue) || null
    }
  } catch (error) {
    console.error('Failed to load users:', error)
    toast.error(t('settings.loadUsersFailed'))
  } finally {
    loading.value = false
  }
}

// 打开弹窗
const openModal = () => {
  if (props.disabled) return
  showModal.value = true
  // 加载用户列表
  if (users.value.length === 0) {
    loadUsers()
  }
  // 聚焦搜索框
  nextTick(() => {
    searchInputRef.value?.focus()
  })
  // 禁止背景滚动
  document.body.style.overflow = 'hidden'
}

// 关闭弹窗
const closeModal = () => {
  showModal.value = false
  searchQuery.value = ''
  // 恢复背景滚动
  document.body.style.overflow = ''
}

// 选择用户
const selectUser = (user: UserListItem) => {
  selectedUser.value = user
  emit('update:modelValue', user.id)
  emit('change', user)
  closeModal()
}

// 清空选择
const clearSelection = () => {
  selectedUser.value = null
  emit('update:modelValue', null)
  emit('change', null)
  closeModal()
}

// ESC 键关闭
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && showModal.value) {
    closeModal()
  }
}

// 监听 modelValue 变化
watch(() => props.modelValue, (newVal) => {
  if (newVal && users.value.length > 0) {
    selectedUser.value = users.value.find(u => u.id === newVal) || null
  } else if (!newVal) {
    selectedUser.value = null
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  // 确保恢复滚动
  document.body.style.overflow = ''
})
</script>

<style scoped>
.user-picker {
  display: inline-block;
}

.picker-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  min-width: 80px;
  background: var(--primary-color);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: white;
  transition: all 0.2s;
}

.picker-trigger:hover:not(.disabled) {
  background: var(--primary-color-dark);
}

.picker-trigger.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.trigger-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.trigger-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-text {
  font-size: 11px;
  font-weight: 600;
  color: white;
}

.trigger-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Modal 样式 */
.user-picker-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.user-picker-modal {
  background: var(--bg-primary);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 90%;
  max-width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  font-size: 20px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.modal-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px;
}

.search-wrapper {
  margin-bottom: 12px;
}

.search-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 14px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  box-sizing: border-box;
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(var(--primary-color-rgb, 0, 123, 255), 0.1);
}

.search-input::placeholder {
  color: var(--text-tertiary, #999);
}

.user-list {
  flex: 1;
  overflow-y: auto;
  min-height: 200px;
  max-height: 400px;
}

.loading-state,
.empty-state {
  padding: 48px 24px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 14px;
}

.user-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.user-item:hover {
  background: var(--bg-secondary);
}

.user-item.selected {
  background: var(--primary-color-light, rgba(0, 123, 255, 0.1));
}

.user-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--bg-tertiary, #e0e0e0);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-secondary);
}

.user-info {
  flex: 1;
  min-width: 0;
}

.user-name {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-username {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.check-icon {
  color: var(--primary-color);
  font-size: 16px;
  font-weight: bold;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color);
}

.btn-cancel,
.btn-clear {
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.btn-cancel:hover {
  background: var(--bg-tertiary, #e0e0e0);
}

.btn-clear {
  background: transparent;
  border: 1px solid var(--danger-color, #dc3545);
  color: var(--danger-color, #dc3545);
}

.btn-clear:hover {
  background: var(--danger-color, #dc3545);
  color: white;
}
</style>