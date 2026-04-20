<template>
  <div class="organization-section">
    <div class="split-panel">
      <div class="panel department-panel">
        <div class="panel-header">
          <h3 class="panel-title">{{ $t('settings.departmentManagement') }}</h3>
          <el-button size="small" @click="openDepartmentDialog()">
            + {{ $t('settings.addDepartment') }}
          </el-button>
        </div>

        <div v-if="loading" class="loading-state">{{ $t('common.loading') }}</div>
        <div v-else-if="departmentTree.length === 0" class="empty-state">{{ $t('settings.noDepartments') }}</div>
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

      <div class="panel position-panel">
        <div class="panel-header">
          <h3 class="panel-title">
            {{ selectedDepartment ? $t('settings.positionsOfDepartment', { name: selectedDepartment.name }) : $t('settings.positionManagement') }}
          </h3>
          <el-button v-if="selectedDepartment" size="small" @click="openPositionDialog()">
            + {{ $t('settings.addPosition') }}
          </el-button>
        </div>

        <div v-if="!selectedDepartment" class="empty-state select-department-hint">{{ $t('settings.selectDepartmentHint') }}</div>
        <div v-else-if="positionLoading" class="loading-state">{{ $t('common.loading') }}</div>
        <div v-else-if="positions.length === 0" class="empty-state">{{ $t('settings.noPositions') }}</div>
        <div v-else class="position-list">
          <div v-for="position in positions" :key="position.id" class="position-item">
            <div class="position-info">
              <span class="position-name">{{ position.name }}</span>
              <el-tag v-if="position.is_manager" type="warning" size="small">{{ $t('settings.manager') }}</el-tag>
            </div>
            <div class="position-user">
              <UserPicker :model-value="getPositionUserId(position.id)" :placeholder="$t('settings.selectUser')" @change="(user) => handlePositionUserChange(position, user)" />
            </div>
            <div class="position-actions">
              <el-button size="small" @click="openPositionDialog(position)">{{ $t('common.edit') }}</el-button>
              <el-button size="small" type="danger" @click="deletePosition(position)">{{ $t('common.delete') }}</el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-dialog v-model="showDepartmentDialog" :title="editingDepartment ? $t('settings.editDepartment') : $t('settings.addDepartment')" width="400px">
      <el-form label-width="100px">
        <el-form-item :label="$t('settings.departmentName')">
          <el-input v-model="departmentForm.name" :placeholder="$t('settings.departmentNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('settings.departmentDescription')">
          <el-input v-model="departmentForm.description" type="textarea" :rows="3" :placeholder="$t('settings.departmentDescriptionPlaceholder')" />
        </el-form-item>
        <el-form-item v-if="editingDepartment" :label="$t('settings.parentDepartment')">
          <el-select v-model="departmentForm.parent_id" clearable>
            <el-option v-for="dept in availableParentDepartments" :key="dept.id" :value="dept.id" :label="dept.name" :disabled="dept.id === editingDepartment?.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeDepartmentDialog">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!departmentForm.name" @click="saveDepartment">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showPositionDialog" :title="editingPosition ? $t('settings.editPosition') : $t('settings.addPosition')" width="400px">
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
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import { departmentApi, positionApi, organizationApi } from '@/api/services'
import type { Department, Position, UserListItem } from '@/types'
import DepartmentTreeNode from './DepartmentTreeNode.vue'
import UserPicker from '@/components/common/UserPicker.vue'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()

const loading = ref(false)
const positionLoading = ref(false)
const departmentTree = ref<Department[]>([])
const selectedDepartment = ref<Department | null>(null)
const positions = ref<Position[]>([])
const positionUserMap = ref<Map<string, string>>(new Map())

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

const selectDepartment = async (dept: Department) => {
  selectedDepartment.value = dept
  await loadPositions(dept.id)
}

const loadPositions = async (departmentId: string) => {
  positionLoading.value = true
  try {
    positions.value = await positionApi.getDepartmentPositions(departmentId)
    await loadPositionUsers()
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
    }
    await loadDepartmentTree()
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('Failed to delete department:', error)
      toast.error(error.response?.data?.message || t('common.deleteFailed'))
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
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('Failed to delete position:', error)
      toast.error(error.response?.data?.message || t('common.deleteFailed'))
    }
  }
}

const getPositionUserId = (positionId: string): string | null => positionUserMap.value.get(positionId) || null

const handlePositionUserChange = async (position: Position, user: UserListItem | null) => {
  try {
    if (user) {
      positionUserMap.value.set(position.id, user.id)
      await organizationApi.updateUserOrganization(user.id, { department_id: selectedDepartment.value?.id || null, position_id: position.id })
    } else {
      positionUserMap.value.delete(position.id)
    }
    toast.success(t('settings.assignSuccess'))
  } catch (error: any) {
    console.error('Failed to assign user to position:', error)
    toast.error(error.response?.data?.message || t('common.saveFailed'))
    await loadPositionUsers()
  }
}

const loadPositionUsers = async () => {
  try {
    for (const position of positions.value) {
      const members = await positionApi.getPositionMembers(position.id)
      if (members?.length > 0) positionUserMap.value.set(position.id, members[0]!.id)
      else positionUserMap.value.delete(position.id)
    }
  } catch (error) {
    console.error('Failed to load position users:', error)
  }
}

onMounted(() => loadDepartmentTree())
</script>

<style scoped>
.organization-section { height: 100%; }
.split-panel { display: flex; gap: 20px; height: calc(100vh - 250px); min-height: 400px; }
.panel { flex: 1; display: flex; flex-direction: column; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
.panel-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); }
.panel-title { margin: 0; font-size: 14px; font-weight: 600; }
.loading-state, .empty-state { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); }
.select-department-hint { font-style: italic; }
.department-tree { flex: 1; overflow-y: auto; padding: 8px; }
.position-list { flex: 1; overflow-y: auto; padding: 8px; }
.position-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid var(--border-color); }
.position-item:last-child { border-bottom: none; }
.position-info { display: flex; align-items: center; gap: 8px; }
.position-name { font-weight: 500; }
.position-user { flex: 0 0 auto; min-width: 140px; }
.position-actions { display: flex; gap: 8px; }
</style>