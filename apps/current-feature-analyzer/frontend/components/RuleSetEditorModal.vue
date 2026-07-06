<template>
  <el-dialog
    :model-value="true"
    title="规则集管理"
    width="960px"
    @close="$emit('close')"
  >
    <el-table :data="ruleSets" size="small" stripe>
      <el-table-column prop="rule_set_name" label="名称" min-width="150" />
      <el-table-column prop="description" label="描述" min-width="200" />
      <el-table-column label="阶段数" width="90">
        <template #default="{ row }">
          <el-button type="primary" plain class="rs-stage-count-btn" @click="manageStages(row.id)">
            <span class="rs-stage-count-number">{{ row.stage_count || 0 }}</span>
            <el-icon><Edit /></el-icon>
          </el-button>
        </template>
      </el-table-column>
      <el-table-column label="配置状态" width="110">
        <template #default="{ row }">
          <el-tag :type="(row.stage_count || 0) > 0 ? 'success' : 'warning'" size="small">
            {{ (row.stage_count || 0) > 0 ? '已配置阶段' : '待配置阶段' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="默认" width="70">
        <template #default="{ row }">
          <el-tag v-if="row.is_default" type="success" size="small">默认</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="is_enabled" label="启用" width="70">
        <template #default="{ row }">
          <el-tag :type="row.is_enabled ? 'success' : 'info'" size="small">{{ row.is_enabled ? '是' : '否' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column width="220" align="right">
        <template #header>
          <div class="rs-table-header-actions">
            <el-button size="small" type="primary" :icon="Plus" @click="createNew">新增规则集</el-button>
          </div>
        </template>
        <template #default="{ row }">
          <el-button-group>
            <el-button :icon="Edit" @click="editBasicInfo(row.id)" />
            <el-button :icon="DocumentCopy" @click="copyRuleSet(row.id)" />
            <el-button type="danger" :icon="Delete" @click="deleteRuleSet(row.id)" />
          </el-button-group>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-if="showBasicDialog"
      :model-value="true"
      :title="editId ? '编辑规则集信息' : '新建规则集'"
      width="680px"
      @close="showBasicDialog = false"
    >
      <el-form :model="editForm" label-width="120px">
        <el-form-item label="名称" required>
          <el-input v-model="editForm.rule_set_name" placeholder="例如：标准启停阶段识别" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editForm.description" type="textarea" :rows="3" placeholder="简要说明该规则集适用的设备、场景或分析目标" />
        </el-form-item>
        <el-form-item label="是否启用">
          <el-switch v-model="editForm.is_enabled" />
        </el-form-item>
        <el-form-item label="设为默认">
          <el-switch v-model="editForm.is_default" />
        </el-form-item>

        <div class="rs-help-text rs-help-text-primary">规则“描述”会作为 AI 的场景判断依据，系统会自动生成分析 Prompt。</div>

        <div class="rs-next-step-tip">
          保存后，可通过阶段数入口继续配置阶段定义。
        </div>
      </el-form>
      <template #footer>
        <el-button @click="showBasicDialog = false">取消</el-button>
        <el-button type="primary" @click="saveBasicInfo">保存基础信息</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-if="showStageDialog"
      :model-value="true"
      :title="getStageDialogTitle()"
      width="820px"
      @close="showStageDialog = false"
    >
      <div class="rs-stage-dialog-head">
        <div class="rs-stage-dialog-subtitle">通过阶段导航切换当前编辑项，逐个完善阶段定义。</div>
      </div>

      <div v-if="editForm.stages.length === 0" class="rs-empty-stage">
        当前还没有阶段定义，请至少添加一个阶段。
      </div>
      <div v-if="editForm.stages.length > 0" class="stage-nav-row">
        <div class="stage-nav-wrap">
          <button
            v-for="(stage, i) in editForm.stages"
            :key="i"
            type="button"
            class="stage-chip"
            :style="getStageChipStyle(stage, i)"
            :class="{
              active: selectedStageIndex === i,
              complete: isStageComplete(stage),
              incomplete: !isStageComplete(stage),
            }"
            @click="selectedStageIndex = i"
          >
            <span class="stage-chip-color" :style="{ backgroundColor: stage.stage_color || getStageColor(i) }"></span>
            <span class="stage-chip-order">{{ stage.stage_order }}</span>
            <span class="stage-chip-name">{{ stage.stage_name || '未命名阶段' }}</span>
            <span v-if="!isStageComplete(stage)" class="stage-chip-dot"></span>
          </button>
          <el-button size="small" class="stage-add-btn" round :icon="Plus" @click="addStage" />
        </div>
      </div>

      <div v-if="currentStage" class="current-stage-panel">
        <el-card shadow="never" class="stage-edit-item">
          <template #header>
            <div class="stage-edit-header">
              <div class="stage-edit-title-group">
              <span class="stage-edit-color" :style="{ backgroundColor: currentStage.stage_color || getStageColor(selectedStageIndex) }"></span>
              <span class="stage-edit-index">阶段 {{ currentStage.stage_order }}</span>
              <span class="stage-edit-title">{{ currentStage.stage_name || '未命名阶段' }}</span>
            </div>
            <el-button size="small" type="danger" text @click="removeStage(selectedStageIndex)">删除</el-button>
          </div>
          </template>

          <el-row :gutter="16">
            <el-col :span="6">
              <div class="stage-field-label">阶段标识</div>
              <el-input v-model="currentStage.stage_code" placeholder="例如：startup_1" size="small" />
            </el-col>
            <el-col :span="6">
              <div class="stage-field-label">阶段名称</div>
              <el-input v-model="currentStage.stage_name" placeholder="例如：启动阶段" size="small" />
            </el-col>
            <el-col :span="6">
              <div class="stage-field-label">顺序</div>
              <el-input-number v-model="currentStage.stage_order" :min="0" size="small" controls-position="right" style="width: 100%" />
            </el-col>
            <el-col :span="6">
              <div class="stage-field-label">标识颜色</div>
              <el-select v-model="currentStage.stage_color" size="small" style="width: 100%">
                <el-option
                  v-for="c in STAGE_PRESET_COLORS"
                  :key="c.value"
                  :label="c.label"
                  :value="c.value"
                >
                  <span class="stage-color-option">
                    <span class="stage-color-dot" :style="{ backgroundColor: c.value }"></span>
                    <span>{{ c.label }}</span>
                  </span>
                </el-option>
              </el-select>
            </el-col>
          </el-row>

          <div class="stage-field-label" style="margin-top: 12px;">业务语义</div>
          <el-input
            v-model="currentStage.semantic_definition"
            type="textarea"
            :rows="3"
            placeholder="说明这一阶段在业务上代表什么，以及应如何从信号变化中识别。阶段特征、判断重点和约束都写在这里。"
          />
        </el-card>
      </div>
      <template #footer>
        <el-button @click="showStageDialog = false">取消</el-button>
        <el-button type="primary" @click="saveStages">保存阶段定义</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, DocumentCopy, Edit, Plus } from '@element-plus/icons-vue'
import { currentFeatureAnalyzerApi, type RuleSetItem } from '../api/current-feature-analyzer'

const props = defineProps<{ ruleSets: RuleSetItem[] }>()
const emit = defineEmits<{ close: []; reload: [] }>()

interface RuleSetEditForm {
  rule_set_name: string
  description: string
  is_enabled: boolean
  is_default: boolean
  stages: Record<string, unknown>[]
}

interface StageEditFormItem {
  stage_code: string
  stage_name: string
  stage_order: number
  stage_color: string
  semantic_definition: string
}

const showBasicDialog = ref(false)
const showStageDialog = ref(false)
const editId = ref<string | null>(null)
const selectedStageIndex = ref(0)
const editForm = reactive<RuleSetEditForm>({
  rule_set_name: '',
  description: '',
  is_enabled: true,
  is_default: false,
  stages: [],
})

const STAGE_PRESET_COLORS = [
  { value: '#3b82f6', label: '蓝色' },
  { value: '#14b8a6', label: '青绿' },
  { value: '#22c55e', label: '绿色' },
  { value: '#f59e0b', label: '琥珀' },
  { value: '#ef4444', label: '红色' },
  { value: '#8b5cf6', label: '紫色' },
  { value: '#ec4899', label: '粉红' },
  { value: '#06b6d4', label: '天蓝' },
  { value: '#84cc16', label: '黄绿' },
  { value: '#f97316', label: '橙色' },
  { value: '#6366f1', label: '靛蓝' },
  { value: '#a855f7', label: '紫罗兰' },
]

const currentStage = computed(() => {
  if (selectedStageIndex.value < 0 || selectedStageIndex.value >= editForm.stages.length) {
    return null
  }
  return editForm.stages[selectedStageIndex.value] as unknown as StageEditFormItem
})

function getErrorMessage(err: unknown, fallback: string) {
  const response = (err as { response?: { data?: { message?: string } } }).response
  return response?.data?.message || fallback
}

function createNew() {
  editId.value = null
  selectedStageIndex.value = 0
  Object.assign(editForm, {
    rule_set_name: '',
    description: '',
    is_enabled: true,
    is_default: false,
    stages: [],
  })
  showBasicDialog.value = true
}

function normalizeStagesOrder() {
  editForm.stages.forEach((stage, index) => {
    stage.stage_order = index
  })
}

async function loadRuleSetForEdit(id: string) {
  const rs = await currentFeatureAnalyzerApi.getRuleSet(id)
  editId.value = id
  selectedStageIndex.value = 0
  Object.assign(editForm, rs)
}

function isStageComplete(stage: Record<string, unknown>) {
  return !!String(stage.stage_code || '').trim()
    && !!String(stage.stage_name || '').trim()
    && !!String(stage.semantic_definition || '').trim()
}

function getStageColor(index: number) {
  return STAGE_PRESET_COLORS[index % STAGE_PRESET_COLORS.length]?.value ?? STAGE_PRESET_COLORS[0]?.value ?? '#3b82f6'
}

function getStageChipStyle(stage: Record<string, unknown>, index: number) {
  const color = String(stage.stage_color || getStageColor(index))
  const isActive = selectedStageIndex.value === index

  return {
    '--stage-chip-color': color,
    borderColor: color,
    backgroundColor: isActive ? color : `${color}14`,
    color: isActive ? '#ffffff' : color,
  }
}

function getStageDialogTitle() {
  return `管理阶段定义 - ${editForm.rule_set_name || '未命名规则集'}`
}

async function editBasicInfo(id: string) {
  try {
    await loadRuleSetForEdit(id)
    showBasicDialog.value = true
  } catch {
    ElMessage.error('加载规则集失败')
  }
}

async function manageStages(id: string) {
  try {
    await loadRuleSetForEdit(id)
    showStageDialog.value = true
  } catch {
    ElMessage.error('加载规则集失败')
  }
}

async function saveBasicInfo() {
  try {
    if (!editForm.rule_set_name.trim()) {
      ElMessage.error('规则集名称不能为空')
      return
    }
    const payload = {
      rule_set_name: editForm.rule_set_name,
      description: editForm.description,
      is_enabled: editForm.is_enabled,
      is_default: editForm.is_default,
    }
    if (editId.value) {
      await currentFeatureAnalyzerApi.updateRuleSet(editId.value, payload)
    } else {
      const created = await currentFeatureAnalyzerApi.createRuleSet(payload)
      editId.value = created.id
    }
    showBasicDialog.value = false
    emit('reload')
    ElMessage.success(editId.value ? '规则集信息已保存' : '规则集已创建')
  } catch (err: unknown) {
    ElMessage.error(getErrorMessage(err, '保存失败'))
  }
}

async function saveStages() {
  try {
    if (!editId.value) {
      ElMessage.error('请先保存规则集基础信息')
      return
    }
    if (editForm.stages.length === 0) {
      ElMessage.error('请至少配置一个阶段定义')
      return
    }
    const invalidStageIndex = editForm.stages.findIndex(stage => {
      return !String(stage.stage_code || '').trim()
        || !String(stage.stage_name || '').trim()
        || !String(stage.semantic_definition || '').trim()
    })
    if (invalidStageIndex >= 0) {
      ElMessage.error(`阶段 ${invalidStageIndex + 1} 缺少必填字段，请补齐阶段标识、阶段名称和业务语义`)
      return
    }
    const updated = await currentFeatureAnalyzerApi.updateRuleSet(editId.value, {
      stages: editForm.stages,
    })
    Object.assign(editForm, updated)
    normalizeStagesOrder()
    if (selectedStageIndex.value >= editForm.stages.length) {
      selectedStageIndex.value = Math.max(editForm.stages.length - 1, 0)
    }
    emit('reload')
    ElMessage.success('当前阶段已经保存')
  } catch (err: unknown) {
    ElMessage.error(getErrorMessage(err, '保存失败'))
  }
}

async function copyRuleSet(id: string) {
  try {
    await currentFeatureAnalyzerApi.copyRuleSet(id)
    emit('reload')
    ElMessage.success('规则集已复制')
  } catch (err: unknown) {
    ElMessage.error(getErrorMessage(err, '复制失败'))
  }
}

async function deleteRuleSet(id: string) {
  try {
    await ElMessageBox.confirm('确定删除该规则集？此操作不可恢复。', '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await currentFeatureAnalyzerApi.deleteRuleSet(id)
    emit('reload')
    ElMessage.success('规则集已删除')
  } catch (err: unknown) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(getErrorMessage(err, '删除失败'))
    }
  }
}

function addStage() {
  const idx = editForm.stages.length
  editForm.stages.push({
    stage_code: '', stage_name: '', stage_order: idx,
    stage_color: STAGE_PRESET_COLORS[idx % STAGE_PRESET_COLORS.length]?.value ?? STAGE_PRESET_COLORS[0]?.value ?? '#3b82f6',
    semantic_definition: '',
  } satisfies StageEditFormItem)
  selectedStageIndex.value = editForm.stages.length - 1
}

function removeStage(i: number) {
  editForm.stages.splice(i, 1)
  normalizeStagesOrder()
  if (editForm.stages.length === 0) {
    selectedStageIndex.value = 0
    return
  }
  if (selectedStageIndex.value >= editForm.stages.length) {
    selectedStageIndex.value = editForm.stages.length - 1
  }
}
</script>

<style scoped>
.rs-table-header-actions {
  display: flex;
  justify-content: flex-end;
}

.stage-nav-row {
  margin-bottom: 16px;
}

.stage-nav-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.stage-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 16px;
  border: 1px solid var(--stage-chip-color);
  border-radius: 999px;
  background: var(--stage-chip-color);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.stage-chip:hover {
  transform: translateY(-1px);
}

.stage-chip.active {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--stage-chip-color) 20%, white);
}

.stage-chip-order {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  font-size: 12px;
  font-weight: 700;
}

.stage-chip-name {
  white-space: nowrap;
}

.stage-chip-color {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35);
}

.stage-chip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.8;
}

.stage-chip.incomplete {
  border-style: dashed;
}

.stage-add-btn {
  flex-shrink: 0;
  min-height: 42px;
  padding: 0 16px;
}

.stage-edit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.stage-edit-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stage-edit-color {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}
.stage-edit-index {
  font-size: 12px;
  color: var(--el-color-primary);
  font-weight: 600;
}
.stage-edit-title {
  font-size: 14px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.stage-field-label {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.stage-color-option {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stage-color-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter);
}
</style>
