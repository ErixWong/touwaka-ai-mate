<template>
  <el-dialog
    :model-value="true"
    title="规则集管理"
    width="800px"
    @close="$emit('close')"
  >
    <div class="rs-editor-toolbar">
      <el-button type="primary" @click="createNew">新建规则集</el-button>
    </div>
    <el-table :data="ruleSets" size="small" stripe>
      <el-table-column prop="rule_set_name" label="名称" min-width="150" />
      <el-table-column prop="description" label="描述" min-width="200" />
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
      <el-table-column label="操作" width="280">
        <template #default="{ row }">
          <el-button size="small" @click="editRuleSet(row.id)">编辑</el-button>
          <el-button size="small" @click="copyRuleSet(row.id)">复制</el-button>
          <el-button size="small" type="danger" @click="deleteRuleSet(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-if="showEditDialog"
      :model-value="true"
      :title="editId ? '编辑规则集' : '新建规则集'"
      width="700px"
      @close="showEditDialog = false"
    >
      <el-form :model="editForm" label-width="120px">
        <el-form-item label="名称" required>
          <el-input v-model="editForm.rule_set_name" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="业务背景">
          <el-input v-model="editForm.business_context" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="Prompt 模板">
          <el-input v-model="editForm.prompt_template" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="JSON Schema">
          <el-input v-model="editForm.output_json_schema" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="是否启用">
          <el-switch v-model="editForm.is_enabled" />
        </el-form-item>
        <el-form-item label="设为默认">
          <el-switch v-model="editForm.is_default" />
        </el-form-item>

        <el-divider>阶段定义</el-divider>
        <div v-for="(stage, i) in editForm.stages" :key="i" class="stage-edit-item">
          <el-row :gutter="8">
            <el-col :span="8">
              <el-input v-model="stage.stage_code" placeholder="编码" size="small" />
            </el-col>
            <el-col :span="8">
              <el-input v-model="stage.stage_name" placeholder="名称" size="small" />
            </el-col>
            <el-col :span="4">
              <el-input-number v-model="stage.stage_order" :min="0" size="small" controls-position="right" />
            </el-col>
            <el-col :span="4">
              <el-button size="small" type="danger" @click="removeStage(Number(i))">删除</el-button>
            </el-col>
          </el-row>
          <el-input v-model="stage.semantic_definition" placeholder="语义定义" size="small" style="margin-top: 4px" />
          <div style="margin-top: 4px; display: flex; gap: 12px">
            <el-checkbox v-model="stage.required" size="small">必选</el-checkbox>
            <el-checkbox v-model="stage.allow_repeat" size="small">允许重复</el-checkbox>
            <el-checkbox v-model="stage.allow_overlap" size="small">允许重叠</el-checkbox>
          </div>
        </div>
        <el-button size="small" style="margin-top: 8px" @click="addStage">+ 添加阶段</el-button>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="saveRuleSet">保存</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { currentFeatureAnalyzerApi, type RuleSetItem } from '../api/current-feature-analyzer'

const props = defineProps<{ ruleSets: RuleSetItem[] }>()
const emit = defineEmits<{ close: []; reload: [] }>()

interface RuleSetEditForm {
  rule_set_name: string
  description: string
  business_context: string
  prompt_template: string
  output_json_schema: string
  is_enabled: boolean
  is_default: boolean
  stages: Record<string, unknown>[]
}

const showEditDialog = ref(false)
const editId = ref<string | null>(null)
const editForm = reactive<RuleSetEditForm>({
  rule_set_name: '',
  description: '',
  business_context: '',
  prompt_template: '',
  output_json_schema: '',
  is_enabled: true,
  is_default: false,
  stages: [],
})

function getErrorMessage(err: unknown, fallback: string) {
  const response = (err as { response?: { data?: { message?: string } } }).response
  return response?.data?.message || fallback
}

function createNew() {
  editId.value = null
  Object.assign(editForm, {
    rule_set_name: '',
    description: '',
    business_context: '',
    prompt_template: '',
    output_json_schema: '',
    is_enabled: true,
    is_default: false,
    stages: [],
  })
  showEditDialog.value = true
}

async function editRuleSet(id: string) {
  try {
    const rs = await currentFeatureAnalyzerApi.getRuleSet(id)
    editId.value = id
    Object.assign(editForm, rs)
    showEditDialog.value = true
  } catch {
    ElMessage.error('加载规则集失败')
  }
}

async function saveRuleSet() {
  try {
    if (editId.value) {
      await currentFeatureAnalyzerApi.updateRuleSet(editId.value, { ...editForm })
    } else {
      await currentFeatureAnalyzerApi.createRuleSet({ ...editForm })
    }
    showEditDialog.value = false
    emit('reload')
    ElMessage.success(editId.value ? '规则集已更新' : '规则集已创建')
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
  editForm.stages.push({
    stage_code: '', stage_name: '', stage_order: editForm.stages.length,
    semantic_definition: '', expected_signal_features: '',
    required: true, allow_repeat: false, allow_overlap: false,
    min_duration_ms: null, max_duration_ms: null, notes: '',
  })
}

function removeStage(i: number) {
  editForm.stages.splice(i, 1)
}
</script>

<style scoped>
.rs-editor-toolbar { margin-bottom: 12px; }
.stage-edit-item {
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 8px;
}
</style>
