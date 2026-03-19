<template>
  <div class="organization-section">
    <div class="split-panel">
      <!-- 左侧：部门树 -->
      <div class="panel department-panel">
        <div class="panel-header">
          <h3 class="panel-title">{{ $t('settings.departmentManagement') }}</h3>
          <button class="btn-icon-add" @click="openDepartmentDialog()" :title="$t('settings.addDepartment')">
            <span class="icon">+</span>
          </button>
        </div>

        <div v-if="loading" class="loading-state">
          {{ $t('common.loading') }}
        </div>

        <div v-else-if="departmentTree.length === 0" class="empty-state">
          {{ $t('settings.noDepartments') }}
        </div>

        <div v-else class="department-tree">
          <DepartmentTreeNode
            v-for="dept in departmentTree"
            :key="dept.id"
            :department="dept"
            :selected-id="selectedDepartment?.id"
            @select="selectDepartment"
            @edit="openDepartmentDialog"
            @delete="deleteDepartment"
            @add-child="openDepartmentDialog"
          />
        </div>
      </div>

      <!-- 右侧：职位列表 -->
      <div class="panel position-panel">
        <div class="panel-header">
          <h3 class="panel-title">
            {{ selectedDepartment 
              ? $t('settings.positionsOfDepartment', { name: selectedDepartment.name }) 
              : $t('settings.positionManagement') 
            }}
          </h3>
          <button
            v-if="selectedDepartment"
            class="btn-icon-add"
            @click="openPositionDialog()"
            :title="$t('settings.addPosition')"
          >
            <span class="icon">+</span>
          </button>
        </div>

        <div v-if="!selectedDepartment" class="empty-state select-department-hint">
          {{ $t('settings.selectDepartmentHint') }}
        </div>

        <div v-else-if="positionLoading" class="loading-state">
          {{ $t('common.loading') }}
        </div>

        <div v-else-if="positions.length === 0" class="empty-state">
          {{ $t('settings.noPositions') }}
        </div>

        <div v-else class="position-list">
          <div
            v-for="position in positions"
            :key="position.id"
            class="position-item"
          >
            <div class="position-info">
              <span class="position-name">{{ position.name }}</span>
              <span v-if="position.is_manager" class="badge manager">
                {{ $t('settings.manager') }}
              </span>
            </div>
            <div class="position-actions">
              <button class="btn-edit" @click="openPositionDialog(position)">
                {{ $t('common.edit') }}
              </button>
              <button class="btn-delete" @click="deletePosition(position)">
                {{ $t('common.delete') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 部门对话框 -->
    <div v-if="showDepartmentDialog" class="dialog-overlay" @click.self="closeDepartmentDialog">
      <div class="dialog">
        <h3 class="dialog-title">
          {{ editingDepartment ? $t('settings.editDepartment') : $t('settings.addDepartment') }}
        </h3>
        <div class="dialog-content">
          <div class="form-item">
            <label class="form-label">{{ $t('settings.departmentName') }}</label>
            <input
              v-model="departmentForm.name"
              type="text"
              class="form-input"
              :placeholder="$t('settings.departmentNamePlaceholder')"
            />
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.departmentDescription') }}</label>
            <textarea
              v-model="departmentForm.description"
              class="form-textarea"
              :placeholder="$t('settings.departmentDescriptionPlaceholder')"
              rows="3"
            ></textarea>
          </div>
          <div v-if="editingDepartment" class="form-item">
            <label class="form-label">{{ $t('settings.parentDepartment') }}</label>
            <select v-model="departmentForm.parent_id" class="form-select">
              <option value="">{{ $t('settings.noParent') }}</option>
              <option
                v-for="dept in availableParentDepartments"
                :key="dept.id"
                :value="dept.id"
                :disabled="dept.id === editingDepartment?.id"
              >
                {{ '  '.repeat(dept.level - 1) }}{{ dept.name }}
              </option>
            </select>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn-cancel" @click="closeDepartmentDialog">
            {{ $t('common.cancel') }}
          </button>
          <button class="btn-save" @click="saveDepartment" :disabled="!departmentForm.name">
            {{ $t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 职位对话框 -->
    <div v-if="showPositionDialog" class="dialog-overlay" @click.self="closePositionDialog">
      <div class="dialog">
        <h3 class="dialog-title">
          {{ editingPosition ? $t('settings.editPosition') : $t('settings.addPosition') }}
        </h3>
        <div class="dialog-content">
          <div class="form-item">
            <label class="form-label">{{ $t('settings.positionName') }}</label>
            <input
              v-model="positionForm.name"
              type="text"
              class="form-input"
              :placeholder="$t('settings.positionNamePlaceholder')"
            />
          </div>
          <div class="form-item">
            <label class="form-checkbox">
              <input type="checkbox" v-model="positionForm.is_manager" />
              <span>{{ $t('settings.isManager') }}</span>
            </label>
          </div>
          <div class="form-item">
            <label class="form-label">{{ $t('settings.positionDescription') }}</label>
            <textarea
              v-model="positionForm.description"
              class="form-textarea"
              :placeholder="$t('settings.positionDescriptionPlaceholder')"
              rows="3"
            ></textarea>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn-cancel" @click="closePositionDialog">
            {{ $t('common.cancel') }}
          </button>
          <button class="btn-save" @click="savePosition" :disabled="!positionForm.name">
            {{ $t('common.save') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { departmentApi, positionApi } from '@/api/services'
import type { Department, Position, CreateDepartmentRequest, CreatePositionRequest } from '@/types'
import DepartmentTreeNode from './DepartmentTreeNode.vue'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()

// 状态
const loading = ref(false)
const positionLoading = ref(false)
const departmentTree = ref<Department[]>([])
const selectedDepartment = ref<Department | null>(null)
const positions = ref<Position[]>([])

// 部门对话框
const showDepartmentDialog = ref(false)
const editingDepartment = ref<Department | null>(null)
const departmentForm = reactive({
  name: '',
  description: '',
  parent_id: '',
})

// 职位对话框
const showPositionDialog = ref(false)
const editingPosition = ref<Position | null>(null)
const positionForm = reactive({
  name: '',
  is_manager: false,
  description: '',
})

// 可选的父部门列表（扁平化）
const availableParentDepartments = computed(() => {
  const flatten = (items: Department[], result: Department[] = []): Department[] => {
    for (const item of items) {
      result.push(item)
      if (item.children?.length) {
        flatten(item.children, result)
      }
    }
    return result
  }
  return flatten(departmentTree.value)
})

// 加载部门树
const loadDepartmentTree = async () => {
  loading.value = true
  try {
    const data = await departmentApi.getDepartmentTree()
    departmentTree.value = data
  } catch (error) {
    console.error('Failed to load department tree:', error)
  } finally {
    loading.value = false
  }
}

// 选择部门
const selectDepartment = async (dept: Department) => {
  selectedDepartment.value = dept
  await loadPositions(dept.id)
}

// 加载职位列表
const loadPositions = async (departmentId: string) => {
  positionLoading.value = true
  try {
    const data = await positionApi.getDepartmentPositions(departmentId)
    positions.value = data
  } catch (error) {
    console.error('Failed to load positions:', error)
  } finally {
    positionLoading.value = false
  }
}

// 打开部门对话框
const openDepartmentDialog = (dept?: Department, parentId?: string) => {
  editingDepartment.value = dept || null
  departmentForm.name = dept?.name || ''
  departmentForm.description = dept?.description || ''
  departmentForm.parent_id = parentId || dept?.parent_id || ''
  showDepartmentDialog.value = true
}

// 关闭部门对话框
const closeDepartmentDialog = () => {
  showDepartmentDialog.value = false
  editingDepartment.value = null
  departmentForm.name = ''
  departmentForm.description = ''
  departmentForm.parent_id = ''
}

// 保存部门
const saveDepartment = async () => {
  if (!departmentForm.name) return

  try {
    if (editingDepartment.value) {
      await departmentApi.updateDepartment(editingDepartment.value.id, {
        name: departmentForm.name,
        description: departmentForm.description,
      })
    } else {
      await departmentApi.createDepartment({
        name: departmentForm.name,
        parent_id: departmentForm.parent_id || undefined,
        description: departmentForm.description || undefined,
      })
    }
    await loadDepartmentTree()
    closeDepartmentDialog()
  } catch (error) {
    console.error('Failed to save department:', error)
    toast.error(t('common.saveFailed'))
  }
}

// 删除部门
const deleteDepartment = async (dept: Department) => {
  if (!confirm(t('settings.confirmDeleteDepartment'))) return

  try {
    await departmentApi.deleteDepartment(dept.id)
    if (selectedDepartment.value?.id === dept.id) {
      selectedDepartment.value = null
      positions.value = []
    }
    await loadDepartmentTree()
  } catch (error: any) {
    console.error('Failed to delete department:', error)
    toast.error(error.response?.data?.message || t('common.deleteFailed'))
  }
}

// 打开职位对话框
const openPositionDialog = (position?: Position) => {
  editingPosition.value = position || null
  positionForm.name = position?.name || ''
  positionForm.is_manager = position?.is_manager || false
  positionForm.description = position?.description || ''
  showPositionDialog.value = true
}

// 关闭职位对话框
const closePositionDialog = () => {
  showPositionDialog.value = false
  editingPosition.value = null
  positionForm.name = ''
  positionForm.is_manager = false
  positionForm.description = ''
}

// 保存职位
const savePosition = async () => {
  if (!positionForm.name || !selectedDepartment.value) return

  try {
    if (editingPosition.value) {
      await positionApi.updatePosition(editingPosition.value.id, {
        name: positionForm.name,
        is_manager: positionForm.is_manager,
        description: positionForm.description,
      })
    } else {
      await positionApi.createPosition({
        name: positionForm.name,
        department_id: selectedDepartment.value.id,
        is_manager: positionForm.is_manager,
        description: positionForm.description || undefined,
      })
    }
    await loadPositions(selectedDepartment.value.id)
    closePositionDialog()
  } catch (error) {
    console.error('Failed to save position:', error)
    toast.error(t('common.saveFailed'))
  }
}

// 删除职位
const deletePosition = async (position: Position) => {
  if (!confirm(t('settings.confirmDeletePosition'))) return

  try {
    await positionApi.deletePosition(position.id)
    await loadPositions(selectedDepartment.value!.id)
  } catch (error: any) {
    console.error('Failed to delete position:', error)
    toast.error(error.response?.data?.message || t('common.deleteFailed'))
  }
}

// 初始化
onMounted(() => {
  loadDepartmentTree()
})
</script>

<style scoped>
.organization-section {
  height: 100%;
}

.split-panel {
  display: flex;
  gap: 20px;
  height: calc(100vh - 250px);
  min-height: 400px;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.btn-icon-add {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-icon-add:hover {
  background: var(--primary-color-dark);
}

.loading-state,
.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.select-department-hint {
  font-style: italic;
}

.department-tree {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.position-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.position-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
}

.position-item:last-child {
  border-bottom: none;
}

.position-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.position-name {
  font-weight: 500;
}

.badge {
  padding: 2px 8px;
  font-size: 12px;
  border-radius: 4px;
}

.badge.manager {
  background: var(--warning-color);
  color: white;
}

.position-actions {
  display: flex;
  gap: 8px;
}

.btn-edit,
.btn-delete {
  padding: 4px 12px;
  font-size: 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-edit {
  background: var(--primary-color);
  color: white;
}

.btn-edit:hover {
  background: var(--primary-color-dark);
}

.btn-delete {
  background: var(--danger-color);
  color: white;
}

.btn-delete:hover {
  background: var(--danger-color-dark);
}

/* 对话框样式 */
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
  background: var(--bg-primary);
  border-radius: 8px;
  width: 400px;
  max-width: 90vw;
}

.dialog-title {
  margin: 0;
  padding: 16px;
  font-size: 16px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
}

.dialog-content {
  padding: 16px;
}

.form-item {
  margin-bottom: 16px;
}

.form-item:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
}

.form-input,
.form-textarea,
.form-select {
  width: 100%;
  padding: 8px 12px;
  font-size: 14px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.form-input:focus,
.form-textarea:focus,
.form-select:focus {
  outline: none;
  border-color: var(--primary-color);
}

.form-textarea {
  resize: vertical;
}

.form-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.form-checkbox input {
  width: 16px;
  height: 16px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid var(--border-color);
}

.btn-cancel,
.btn-save {
  padding: 8px 16px;
  font-size: 14px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-cancel {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.btn-cancel:hover {
  background: var(--bg-tertiary);
}

.btn-save {
  background: var(--primary-color);
  color: white;
}

.btn-save:hover {
  background: var(--primary-color-dark);
}

.btn-save:disabled {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: not-allowed;
}
</style>
