<template>
  <div class="assistant-settings-tab">
    <!-- 面板标题 -->
    <div class="panel-header">
      <h3 class="panel-title">{{ $t('settings.assistantSettings') }}</h3>
      <button class="btn-icon-add" @click="openCreateDialog" :title="$t('assistant.addAssistant')">
        <span class="icon">+</span>
      </button>
    </div>

    <!-- 加载状态 -->
    <div v-if="assistantStore.isLoading && assistantStore.assistants.length === 0" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <!-- 空状态 -->
    <div v-else-if="assistantStore.assistants.length === 0" class="empty-state">
      {{ $t('assistant.noAssistants') }}
    </div>

    <!-- 助理列表 -->
    <div v-else class="assistant-list-container">
      <div class="assistant-list">
        <div
          v-for="assistant in assistantStore.assistants"
          :key="assistant.id"
          class="assistant-item"
          :class="{ inactive: !assistant.is_active }"
        >
          <div class="assistant-header">
            <div class="assistant-info">
              <span class="assistant-name">{{ assistant.name }}</span>
              <span v-if="!assistant.is_active" class="badge inactive">
                {{ $t('settings.inactive') }}
              </span>
            </div>
            <div class="assistant-actions">
              <button
                class="btn-edit"
                :class="{ 'btn-inactive': !assistant.is_active }"
                @click="openEditDialog(assistant)"
                :title="$t('common.edit')"
              >
                {{ $t('common.edit') }}
              </button>
              <button
                class="btn-delete-small"
                @click="confirmDeleteAssistant(assistant)"
                :title="$t('common.delete')"
              >
                {{ $t('common.delete') }}
              </button>
            </div>
          </div>
          <p v-if="assistant.description" class="assistant-intro">{{ assistant.description }}</p>
        </div>
      </div>
    </div>

    <!-- 编辑/创建弹窗 -->
    <AssistantEditDialog
      v-if="showEditDialog"
      :assistant="editingAssistant"
      :models="availableModels"
      :is-create="isCreateMode"
      @close="closeEditDialog"
      @save="handleSave"
      @create="handleCreate"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAssistantStore } from '@/stores/assistant'
import { useModelStore } from '@/stores/model'
import type { Assistant } from '@/types'
import AssistantEditDialog from './AssistantEditDialog.vue'

const { t } = useI18n()
const assistantStore = useAssistantStore()
const modelStore = useModelStore()

// 编辑弹窗状态
const showEditDialog = ref(false)
const editingAssistant = ref<Assistant | null>(null)
const isCreateMode = ref(false)

// 可用模型列表
const availableModels = computed(() => {
  return modelStore.models.filter(m => m.is_active)
})

// 打开编辑弹窗
function openEditDialog(assistant: Assistant) {
  isCreateMode.value = false
  editingAssistant.value = { ...assistant }
  showEditDialog.value = true
}

// 打开创建弹窗
function openCreateDialog() {
  isCreateMode.value = true
  editingAssistant.value = null
  showEditDialog.value = true
}

// 关闭编辑弹窗
function closeEditDialog() {
  showEditDialog.value = false
  editingAssistant.value = null
  isCreateMode.value = false
}

// 保存助理配置
async function handleSave(data: Partial<Assistant>) {
  if (!editingAssistant.value) return

  try {
    await assistantStore.updateAssistant(editingAssistant.value.id, data)
    closeEditDialog()
  } catch (error) {
    console.error('Failed to save assistant:', error)
  }
}

// 创建助理
async function handleCreate(data: Partial<Assistant> & { name: string }) {
  try {
    await assistantStore.createAssistant(data)
    closeEditDialog()
  } catch (error) {
    console.error('Failed to create assistant:', error)
  }
}

// 确认删除助理
function confirmDeleteAssistant(assistant: Assistant) {
  if (confirm(t('assistant.confirmDelete', { name: assistant.name }))) {
    assistantStore.deleteAssistant(assistant.id)
  }
}

// 加载数据
onMounted(async () => {
  if (assistantStore.assistants.length === 0) {
    await assistantStore.fetchAssistants()
  }
  if (modelStore.models.length === 0) {
    await modelStore.loadModels()
  }
})
</script>

<style scoped>
.assistant-settings-tab {
  padding: 0;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--card-bg, #fff);
}

.panel-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.btn-icon-add {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  background: var(--card-bg, #fff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.btn-icon-add:hover {
  background: var(--primary-color, #2196f3);
  color: white;
  border-color: var(--primary-color, #2196f3);
}

.btn-icon-add .icon {
  font-size: 18px;
  font-weight: bold;
}

.loading-state {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #666);
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary, #666);
}

.assistant-list-container {
  display: flex;
  flex-direction: column;
  min-height: 400px;
}

.assistant-list {
  flex: 1;
  padding: 16px;
}

.assistant-item {
  padding: 16px;
  margin-bottom: 12px;
  border-radius: 10px;
  background: var(--secondary-bg, #f8f9fa);
  border: 1px solid transparent;
  transition: all 0.2s;
}

.assistant-item:hover {
  background: var(--hover-bg, #e8e8e8);
  border-color: var(--border-color, #e0e0e0);
}

.assistant-item.inactive {
  opacity: 0.6;
}

.assistant-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.assistant-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.assistant-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.assistant-actions {
  display: flex;
  gap: 8px;
}

.assistant-intro {
  font-size: 13px;
  color: var(--text-secondary, #666);
  margin: 0 0 8px 0;
  line-height: 1.5;
}

.btn-edit {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  background: var(--card-bg, #fff);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-edit:hover {
  background: var(--primary-color, #2196f3);
  color: white;
  border-color: var(--primary-color, #2196f3);
}

.btn-edit.btn-inactive {
  opacity: 0.6;
}

.btn-delete-small {
  padding: 4px 10px;
  background: white;
  border: 1px solid var(--error-color, #c62828);
  border-radius: 6px;
  font-size: 12px;
  color: var(--error-color, #c62828);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-delete-small:hover {
  background: var(--error-bg, #ffebee);
}

.badge.inactive {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  background: var(--warning-bg, #fff3e0);
  color: var(--warning-color, #f57c00);
}
</style>