<template>
  <div class="user-picker" ref="pickerRef">
    <button
      class="picker-trigger"
      :class="{ disabled, 'has-value': !!selectedUser }"
      @click="toggleDropdown"
      :disabled="disabled"
    >
      <span class="trigger-text">
        <template v-if="selectedUser">
          {{ selectedUser.nickname || selectedUser.username }}
        </template>
        <template v-else>
          {{ placeholder }}
        </template>
      </span>
      <span class="trigger-icon">▼</span>
    </button>

    <!-- 下拉选择面板 -->
    <div v-if="showDropdown" class="picker-dropdown">
      <div class="dropdown-search">
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          class="search-input"
          :placeholder="$t('settings.searchUser')"
          @input="handleSearch"
        />
      </div>

      <div class="dropdown-list">
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

      <!-- 清空选择 -->
      <div v-if="modelValue" class="dropdown-footer">
        <button class="clear-btn" @click="clearSelection">
          {{ $t('common.none') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { userApi } from '@/api/services'
import type { UserListItem } from '@/types'

interface Props {
  modelValue?: string | null
  placeholder?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  placeholder: '选择人员',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [userId: string | null]
  'change': [user: UserListItem | null]
}>()

const { t } = useI18n()

// 状态
const pickerRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const showDropdown = ref(false)
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
  } finally {
    loading.value = false
  }
}

// 切换下拉面板
const toggleDropdown = () => {
  if (props.disabled) return
  showDropdown.value = !showDropdown.value
  if (showDropdown.value) {
    setTimeout(() => {
      searchInputRef.value?.focus()
    }, 100)
  }
}

// 选择用户
const selectUser = (user: UserListItem) => {
  selectedUser.value = user
  emit('update:modelValue', user.id)
  emit('change', user)
  showDropdown.value = false
  searchQuery.value = ''
}

// 清空选择
const clearSelection = () => {
  selectedUser.value = null
  emit('update:modelValue', null)
  emit('change', null)
  showDropdown.value = false
  searchQuery.value = ''
}

// 搜索处理（防抖）
let searchTimeout: ReturnType<typeof setTimeout> | null = null
const handleSearch = () => {
  if (searchTimeout) clearTimeout(searchTimeout)
  // 本地过滤，无需重新请求
}

// 点击外部关闭
const handleClickOutside = (event: MouseEvent) => {
  if (pickerRef.value && !pickerRef.value.contains(event.target as Node)) {
    showDropdown.value = false
    searchQuery.value = ''
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
  loadUsers()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.user-picker {
  position: relative;
  display: inline-block;
}

.picker-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  min-width: 120px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: all 0.2s;
}

.picker-trigger:hover:not(.disabled) {
  border-color: var(--primary-color);
}

.picker-trigger.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.picker-trigger.has-value .trigger-text {
  color: var(--text-primary);
}

.trigger-text {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.trigger-icon {
  font-size: 10px;
  color: var(--text-secondary);
}

.picker-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  min-width: 240px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}

.dropdown-search {
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
}

.search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 13px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.dropdown-list {
  max-height: 240px;
  overflow-y: auto;
}

.loading-state,
.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.user-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
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
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
}

.user-info {
  flex: 1;
  min-width: 0;
}

.user-name {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-username {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
}

.check-icon {
  color: var(--primary-color);
  font-size: 14px;
}

.dropdown-footer {
  padding: 8px;
  border-top: 1px solid var(--border-color);
}

.clear-btn {
  width: 100%;
  padding: 8px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.clear-btn:hover {
  background: var(--bg-secondary);
  color: var(--danger-color);
  border-color: var(--danger-color);
}
</style>