<template>
  <div class="app-management-tab">
    <div class="panel-header">
      <h3 class="panel-title">{{ $t('settings.appManagement') }}</h3>
      <button class="btn-icon-add" @click="openAppDialog()" :title="$t('settings.appManagement.addApp')">
        <span class="icon">+</span>
      </button>
    </div>

    <div v-if="loading" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="apps.length === 0" class="empty-state">
      <div class="empty-icon">📱</div>
      <p>{{ $t('settings.appManagement.noApps') }}</p>
    </div>

    <div v-else class="app-list-container">
      <div class="app-list">
        <div
          v-for="app in apps"
          :key="app.id"
          class="app-item"
          :class="{ inactive: !app.is_active }"
        >
          <div class="app-icon">{{ app.icon || '📱' }}</div>
          <div class="app-info">
            <div class="app-header-row">
              <span class="app-name">{{ app.name }}</span>
              <span class="badge" :class="app.type">{{ typeLabels[app.type] || app.type }}</span>
              <span v-if="!app.is_active" class="badge inactive">{{ $t('settings.inactive') }}</span>
            </div>
            <p v-if="app.description" class="app-desc">{{ app.description }}</p>
            <div class="app-meta">
              <span class="meta-item">{{ $t('settings.appManagement.fieldCount', { count: app.fields?.length || 0 }) }}</span>
              <span class="meta-separator">·</span>
              <span class="meta-item">{{ $t('settings.appManagement.visibility') }}: {{ visibilityLabels[app.visibility] || app.visibility }}</span>
            </div>
          </div>
          <div class="app-actions">
            <button class="btn-edit" @click="openAppDialog(app)" :title="$t('common.edit')">
              {{ $t('common.edit') }}
            </button>
            <button class="btn-delete-small" @click="confirmDeleteApp(app)" :title="$t('common.delete')">
              {{ $t('common.delete') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- App 编辑对话框 -->
    <div v-if="showAppDialog" class="dialog-overlay" @click.self="closeAppDialog">
      <div class="dialog dialog-large">
        <h3 class="dialog-title">
          {{ editingApp ? $t('settings.appManagement.editApp') : $t('settings.appManagement.addApp') }}
        </h3>
        <div class="dialog-body">
          <div class="app-dialog-tabs">
            <button
              v-for="tab in appDialogTabs"
              :key="tab.key"
              class="sub-tab-btn"
              :class="{ active: appDialogTab === tab.key }"
              @click="appDialogTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>

          <!-- 基本信息 -->
          <div v-if="appDialogTab === 'basic'" class="tab-pane"><div class="form-row">
              <div class="form-item">
                <label class="form-label">{{ $t('settings.appManagement.appName') }} *</label>
                <input v-model="appForm.name" type="text" class="form-input" :placeholder="$t('settings.appManagement.appNamePlaceholder')" />
              </div>
              <div class="form-item">
                <label class="form-label">{{ $t('settings.appManagement.icon') }}</label>
                <input v-model="appForm.icon" type="text" class="form-input" placeholder="📄" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-item">
                <label class="form-label">{{ $t('settings.appManagement.type') }}</label>
                <select v-model="appForm.type" class="form-input">
                  <option value="document">{{ typeLabels.document }}</option>
                  <option value="workflow">{{ typeLabels.workflow }}</option>
                  <option value="data">{{ typeLabels.data }}</option>
                  <option value="utility">{{ typeLabels.utility }}</option>
                </select>
              </div>
              <div class="form-item">
                <label class="form-label">{{ $t('settings.appManagement.visibility') }}</label>
                <select v-model="appForm.visibility" class="form-input">
                  <option value="all">{{ visibilityLabels.all }}</option>
                  <option value="department">{{ visibilityLabels.department }}</option>
                  <option value="owner">{{ visibilityLabels.owner }}</option>
                  <option value="role">{{ visibilityLabels.role }}</option>
                </select>
              </div>
            </div>
            <div class="form-item">
              <label class="form-label">{{ $t('settings.appManagement.description') }}</label>
              <textarea v-model="appForm.description" class="form-input" rows="2" :placeholder="$t('settings.appManagement.descriptionPlaceholder')"></textarea>
            </div>
            <div class="form-item checkbox">
              <label class="form-label">
                <input v-model="appForm.is_active" type="checkbox" />
                {{ $t('settings.isActive') }}
              </label>
            </div>
          </div>

          <!-- 字段设计器 -->
          <div v-if="appDialogTab === 'fields'" class="tab-pane">
            <div class="field-designer">
              <div class="field-list">
                <div
                  v-for="(field, index) in appForm.fields"
                  :key="index"
                  class="field-item"
                  :class="{ active: selectedFieldIndex === index }"
                  @click="selectedFieldIndex = index"
                >
                  <div class="field-item-info">
                    <span class="field-type-badge">{{ field.type }}</span>
                    <span class="field-item-name">{{ field.label || field.name }}</span>
                    <span v-if="field.required" class="required-mark">*</span>
                  </div>
                  <div class="field-item-actions">
                    <button v-if="index > 0" class="btn-tiny" @click.stop="moveField(index, -1)">↑</button>
                    <button v-if="index < appForm.fields.length - 1" class="btn-tiny" @click.stop="moveField(index, 1)">↓</button>
                    <button class="btn-tiny btn-danger" @click.stop="removeField(index)">×</button>
                  </div>
                </div>
              </div>
              <button class="btn-secondary" @click="addField">
                + {{ $t('settings.appManagement.addField') }}
              </button>
            </div>

            <!-- 字段编辑面板 -->
            <div v-if="selectedField" class="field-edit-panel">
              <h4 class="panel-subtitle">{{ $t('settings.appManagement.fieldConfig') }}</h4>
              <div class="form-row">
                <div class="form-item">
                  <label class="form-label">Name *</label>
                  <input v-model="selectedField.name" type="text" class="form-input" placeholder="field_name" />
                </div>
                <div class="form-item">
                  <label class="form-label">{{ $t('settings.appManagement.fieldLabel') }} *</label>
                  <input v-model="selectedField.label" type="text" class="form-input" :placeholder="$t('settings.appManagement.fieldLabelPlaceholder')" />
                </div>
              </div>
              <div class="form-row">
                <div class="form-item">
                  <label class="form-label">{{ $t('settings.appManagement.fieldType') }}</label>
                  <select v-model="selectedField.type" class="form-input">
                    <option value="text">Text</option>
                    <option value="textarea">TextArea</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="select">Select</option>
                    <option value="multiselect">MultiSelect</option>
                    <option value="boolean">Boolean</option>
                    <option value="file">File</option>
                  </select>
                </div>
                <div class="form-item">
                  <label class="form-label">{{ $t('settings.appManagement.defaultValue') }}</label>
                  <input v-model="selectedField.default" type="text" class="form-input" />
                </div>
              </div>
              <div v-if="selectedField.type === 'select' || selectedField.type === 'multiselect'" class="form-item">
                <label class="form-label">{{ $t('settings.appManagement.options') }}</label>
                <input v-model="optionsText" type="text" class="form-input" :placeholder="$t('settings.appManagement.optionsPlaceholder')" @input="updateFieldOptions" />
                <p class="form-hint">{{ $t('settings.appManagement.optionsHint') }}</p>
              </div>
              <div class="form-item-group">
                <label class="form-label checkbox">
                  <input v-model="selectedField.required" type="checkbox" />
                  {{ $t('settings.appManagement.required') }}
                </label>
                <label class="form-label checkbox">
                  <input v-model="selectedField.ai_extractable" type="checkbox" />
                  {{ $t('settings.appManagement.aiExtractable') }}
                </label>
              </div>
            </div>
            <div v-else class="field-edit-empty">
              {{ $t('settings.appManagement.selectFieldHint') }}
            </div>
          </div>

          <!-- 状态设计器 -->
          <div v-if="appDialogTab === 'states'" class="tab-pane">
            <StateDesigner
              v-model:states="appForm.states"
              :handlers="handlers"
            />
          </div>
        </div>
        <div class="dialog-footer">
          <div class="footer-left">
            <button v-if="editingApp" class="btn-delete" @click="confirmDeleteFromDialog">
              {{ $t('common.delete') }}
            </button>
          </div>
          <div class="footer-right">
            <button class="btn-cancel" @click="closeAppDialog">{{ $t('common.cancel') }}</button>
            <button class="btn-confirm" :disabled="!isAppFormValid" @click="saveApp">
              {{ $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="showDeleteDialog" class="dialog-overlay">
      <div class="dialog dialog-confirm">
        <h3 class="dialog-title">{{ $t('common.confirmDelete') }}</h3>
        <p class="dialog-message">
          {{ $t('settings.appManagement.deleteConfirm', { name: deletingApp?.name }) }}
        </p>
        <div class="dialog-footer">
          <button class="btn-cancel" @click="showDeleteDialog = false">{{ $t('common.cancel') }}</button>
          <button class="btn-confirm delete" @click="deleteApp">{{ $t('common.delete') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'
import { getApps, createApp, updateApp, deleteApp as deleteAppApi, getHandlers } from '@/api/mini-apps'
import type { MiniApp, AppField, AppState, AppRowHandler } from '@/api/mini-apps'
import StateDesigner from '@/components/settings/StateDesigner.vue'

const { t } = useI18n()
const toast = useToastStore()
const userStore = useUserStore()

const isAdmin = computed(() => userStore.isAdmin)
const loading = ref(false)
const apps = ref<MiniApp[]>([])
const handlers = ref<AppRowHandler[]>([])
const showAppDialog = ref(false)
const showDeleteDialog = ref(false)
const editingApp = ref<MiniApp | null>(null)
const deletingApp = ref<MiniApp | null>(null)
const appDialogTab = ref<string>('basic')
const selectedFieldIndex = ref(-1)

const typeLabels: Record<string, string> = {
  document: t('settings.appManagement.typeDocument', '文档'),
  workflow: t('settings.appManagement.typeWorkflow', '工作流'),
  data: t('settings.appManagement.typeData', '数据'),
  utility: t('settings.appManagement.typeUtility', '工具'),
}

const visibilityLabels: Record<string, string> = {
  all: t('settings.appManagement.visibilityAll', '全员'),
  department: t('settings.appManagement.visibilityDepartment', '部门'),
  owner: t('settings.appManagement.visibilityOwner', '仅管理员'),
  role: t('settings.appManagement.visibilityRole', '指定角色'),
}

const appDialogTabs = computed(() => [
  { key: 'basic', label: t('settings.appManagement.tabBasic', '基本信息') },
  { key: 'fields', label: t('settings.appManagement.tabFields', '字段设计') },
  { key: 'states', label: t('settings.appManagement.tabStates', '状态流转') },
])

const appForm = reactive({
  name: '',
  icon: '📱',
  type: 'document' as string,
  description: '',
  visibility: 'all' as string,
  is_active: true,
  fields: [] as AppField[],
  states: [] as AppState[],
})

const selectedField = computed(() => {
  if (selectedFieldIndex.value >= 0 && selectedFieldIndex.value < appForm.fields.length) {
    return appForm.fields[selectedFieldIndex.value]
  }
  return null
})

const optionsText = computed({
  get: () => {
    const field = selectedField.value
    return field?.options?.join(', ') || ''
  },
  set: () => {},
})

const isAppFormValid = computed(() => {
  return appForm.name.trim().length > 0
})

function updateFieldOptions(e: Event) {
  const input = e.target as HTMLInputElement
  const field = selectedField.value
  if (field) {
    field.options = input.value.split(',').map(s => s.trim()).filter(Boolean)
  }
}

function addField() {
  const newField: AppField = {
    name: `field_${appForm.fields.length + 1}`,
    label: '',
    type: 'text',
    required: false,
    ai_extractable: false,
  }
  appForm.fields.push(newField)
  selectedFieldIndex.value = appForm.fields.length - 1
}

function removeField(index: number) {
  appForm.fields.splice(index, 1)
  if (selectedFieldIndex.value >= appForm.fields.length) {
    selectedFieldIndex.value = appForm.fields.length - 1
  }
}

function moveField(index: number, direction: number) {
  const newIndex = index + direction
  if (newIndex < 0 || newIndex >= appForm.fields.length) return
  const temp = appForm.fields[index]!
  appForm.fields[index] = appForm.fields[newIndex]!
  appForm.fields[newIndex] = temp
  if (selectedFieldIndex.value === index) {
    selectedFieldIndex.value = newIndex
  }
}

function openAppDialog(app?: MiniApp) {
  if (app) {
    editingApp.value = app
    appForm.name = app.name
    appForm.icon = app.icon || '📱'
    appForm.type = app.type
    appForm.description = app.description || ''
    appForm.visibility = app.visibility
    appForm.is_active = app.is_active
    appForm.fields = JSON.parse(JSON.stringify(app.fields || []))
    appForm.states = JSON.parse(JSON.stringify(app.states || []))
  } else {
    editingApp.value = null
    appForm.name = ''
    appForm.icon = '📱'
    appForm.type = 'document'
    appForm.description = ''
    appForm.visibility = 'all'
    appForm.is_active = true
    appForm.fields = []
    appForm.states = []
  }
  selectedFieldIndex.value = -1
  appDialogTab.value = 'basic'
  showAppDialog.value = true
}

function closeAppDialog() {
  showAppDialog.value = false
  editingApp.value = null
}

function confirmDeleteApp(app: MiniApp) {
  deletingApp.value = app
  showDeleteDialog.value = true
}

function confirmDeleteFromDialog() {
  if (editingApp.value) {
    showAppDialog.value = false
    confirmDeleteApp(editingApp.value)
  }
}

async function loadApps() {
  loading.value = true
  try {
    apps.value = await getApps()
  } catch (error: any) {
    toast.error(t('settings.appManagement.loadFailed', '加载失败') + ': ' + error.message)
  } finally {
    loading.value = false
  }
}

async function loadHandlers() {
  try {
    handlers.value = await getHandlers()
  } catch {
    handlers.value = []
  }
}

async function saveApp() {
  try {
    const data: any = {
      name: appForm.name,
      icon: appForm.icon,
      type: appForm.type,
      description: appForm.description,
      visibility: appForm.visibility,
      is_active: appForm.is_active,
      fields: appForm.fields,
    }
    if (editingApp.value) {
      await updateApp(editingApp.value.id, data)
      toast.success(t('settings.appManagement.updateSuccess', 'App 更新成功'))
    } else {
      await createApp(data)
      toast.success(t('settings.appManagement.createSuccess', 'App 创建成功'))
    }
    closeAppDialog()
    await loadApps()
  } catch (error: any) {
    toast.error(t('settings.appManagement.saveFailed', '保存失败') + ': ' + error.message)
  }
}

async function deleteApp() {
  if (!deletingApp.value) return
  try {
    await deleteAppApi(deletingApp.value.id)
    toast.success(t('settings.appManagement.deleteSuccess', 'App 已删除'))
    showDeleteDialog.value = false
    deletingApp.value = null
    await loadApps()
  } catch (error: any) {
    toast.error(t('settings.appManagement.deleteFailed', '删除失败') + ': ' + error.message)
  }
}

onMounted(() => {
  loadApps()
  loadHandlers()
})
</script>

<style scoped>
.app-management-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.app-list-container {
  display: flex;
  flex-direction: column;
}

.app-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.app-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e0e0e0);
  transition: border-color 0.2s;
}

.app-item:hover {
  border-color: var(--primary-color, #2196f3);
}

.app-item.inactive {
  opacity: 0.6;
}

.app-icon {
  font-size: 24px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--bg-secondary, #f5f5f5);
}

.app-info {
  flex: 1;
  min-width: 0;
}

.app-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.app-name {
  font-weight: 500;
  font-size: 14px;
  color: var(--text-primary, #333);
}

.app-desc {
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin: 4px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-tertiary, #999);
}

.meta-separator {
  color: var(--border-color, #e0e0e0);
}

.app-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-secondary, #f0f0f0);
  color: var(--text-secondary, #666);
}

.badge.document { background: #e3f2fd; color: #1565c0; }
.badge.workflow { background: #fff3e0; color: #e65100; }
.badge.data { background: #e8f5e9; color: #2e7d32; }
.badge.utility { background: #f3e5f5; color: #7b1fa2; }
.badge.inactive { background: #fafafa; color: #999; }

.app-dialog-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  padding-bottom: 8px;
}

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field-designer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #e0e0e0);
  cursor: pointer;
  transition: border-color 0.2s;
}

.field-item:hover,
.field-item.active {
  border-color: var(--primary-color, #2196f3);
}

.field-item.active {
  background: var(--primary-color-light, rgba(33, 150, 243, 0.05));
}

.field-item-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-type-badge {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--bg-secondary, #f0f0f0);
  color: var(--text-secondary, #666);
  text-transform: uppercase;
}

.field-item-name {
  font-size: 13px;
  color: var(--text-primary, #333);
}

.required-mark {
  color: #e53935;
  font-weight: bold;
}

.field-item-actions {
  display: flex;
  gap: 4px;
}

.btn-tiny {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #666);
}

.btn-tiny:hover {
  background: var(--bg-secondary, #f5f5f5);
}

.btn-tiny.btn-danger:hover {
  background: #ffebee;
  color: #e53935;
}

.field-edit-panel {
  padding: 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  background: var(--bg-secondary, #fafafa);
}

.field-edit-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-tertiary, #999);
  border: 1px dashed var(--border-color, #e0e0e0);
  border-radius: 8px;
}

.panel-subtitle {
  font-size: 13px;
  font-weight: 500;
  margin: 0 0 12px;
  color: var(--text-primary, #333);
}

.form-item-group {
  display: flex;
  gap: 24px;
  padding-top: 8px;
}

.form-item-group .form-label.checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: 500;
  margin: 0;
}

.btn-icon-add {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px dashed var(--border-color, #e0e0e0);
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color, #2196f3);
}

.btn-icon-add:hover {
  border-color: var(--primary-color, #2196f3);
  background: var(--primary-color-light, rgba(33, 150, 243, 0.05));
}

.btn-edit {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #e0e0e0);
  background: white;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-primary, #333);
}

.btn-edit:hover {
  border-color: var(--primary-color, #2196f3);
  color: var(--primary-color, #2196f3);
}

.btn-delete-small {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #e0e0e0);
  background: white;
  cursor: pointer;
  font-size: 12px;
  color: #e53935;
}

.btn-delete-small:hover {
  background: #ffebee;
  border-color: #e53935;
}

.btn-secondary {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px dashed var(--border-color, #e0e0e0);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--primary-color, #2196f3);
}

.btn-secondary:hover {
  border-color: var(--primary-color, #2196f3);
  background: var(--primary-color-light, rgba(33, 150, 243, 0.05));
}

.btn-save {
  padding: 8px 24px;
  border-radius: 6px;
  border: none;
  background: var(--primary-color, #2196f3);
  color: white;
  cursor: pointer;
  font-size: 14px;
}

.btn-save:hover {
  opacity: 0.9;
}

.dialog-overlay {
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

.dialog {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 520px;
  max-height: 80vh;
  overflow-y: auto;
}

.dialog-large {
  max-width: 720px;
}

.dialog-confirm {
  max-width: 400px;
}

.dialog-title {
  font-size: 16px;
  font-weight: 500;
  padding: 16px 20px;
  margin: 0;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.dialog-body {
  padding: 16px 20px;
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.dialog-footer .footer-left {
  flex: 1;
}

.dialog-footer .footer-right {
  display: flex;
  gap: 8px;
}

.dialog-message {
  padding: 16px 20px;
  color: var(--text-secondary, #666);
}

.btn-cancel {
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid var(--border-color, #e0e0e0);
  background: white;
  cursor: pointer;
  font-size: 13px;
}

.btn-confirm {
  padding: 6px 16px;
  border-radius: 6px;
  border: none;
  background: var(--primary-color, #2196f3);
  color: white;
  cursor: pointer;
  font-size: 13px;
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-confirm.delete {
  background: #e53935;
}

.btn-delete {
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid #e53935;
  background: white;
  cursor: pointer;
  font-size: 13px;
  color: #e53935;
}

.btn-delete:hover {
  background: #ffebee;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-tertiary, #999);
}

.empty-icon {
  font-size: 36px;
  margin-bottom: 8px;
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #333);
}

.form-input {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: var(--primary-color, #2196f3);
}

.form-hint {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  margin: 2px 0 0;
}

.form-item.checkbox {
  flex-direction: row;
  align-items: center;
}

.sub-tab-btn {
  padding: 6px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary, #666);
  border-bottom: 2px solid transparent;
}

.sub-tab-btn.active {
  color: var(--primary-color, #2196f3);
  border-bottom-color: var(--primary-color, #2196f3);
}

.sub-tab-btn:hover {
  color: var(--primary-color, #2196f3);
}
</style>
