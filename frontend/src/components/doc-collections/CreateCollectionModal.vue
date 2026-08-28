<template>
  <el-dialog
    :model-value="props.visible"
    :title="$t('docs.workspace.home.createCollection')"
    width="520px"
    @update:model-value="$emit('update:visible', $event)"
    @open="onOpen"
    :close-on-click-modal="false"
  >
    <el-alert
      v-if="!userHasDepartment"
      class="dept-alert-top"
      type="warning"
      :closable="false"
      show-icon
      :title="deptRequiredHint"
    />
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item :label="$t('docs.workspace.settings.collectionName')" prop="name">
        <el-input v-model="form.name" maxlength="100" show-word-limit :placeholder="$t('docs.workspace.settings.collectionNamePlaceholder')" />
      </el-form-item>
      <el-form-item :label="$t('docs.workspace.settings.description')" prop="description">
        <el-input v-model="form.description" type="textarea" maxlength="500" show-word-limit :placeholder="$t('docs.workspace.settings.descriptionPlaceholder')" :rows="3" />
      </el-form-item>
      <el-form-item :label="$t('docs.workspace.settings.embeddingModel')" prop="embedding_model_id">
        <el-select v-model="form.embedding_model_id" :placeholder="$t('docs.workspace.settings.embeddingModelPlaceholder')" style="width:100%">
          <el-option v-for="m in embeddingModels" :key="m.id" :label="m.name" :value="m.id" />
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('docs.workspace.settings.visibility')" prop="visibility">
        <el-radio-group v-model="form.visibility">
          <el-radio value="private">{{ $t('docs.workspace.settings.visibilityPrivate') }}</el-radio>
          <el-radio value="department" :disabled="!userHasDepartment">{{ $t('docs.workspace.settings.visibilityDepartment') }}</el-radio>
          <el-radio value="public">{{ $t('docs.workspace.settings.visibilityPublic') }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="form.visibility === 'department'" :label="$t('docs.workspace.settings.department')" prop="department_id">
        <el-tree-select
          v-model="form.department_id"
          :data="departmentTree"
          :props="{ label: 'name', value: 'id', children: 'children' }"
          :placeholder="$t('docs.workspace.settings.departmentPlaceholder')"
          check-strictly
          style="width:100%"
        />
      </el-form-item>
      <el-form-item v-if="form.visibility === 'department'" :label="$t('docs.workspace.settings.departmentScope')" prop="department_scope">
        <el-radio-group v-model="form.department_scope">
          <el-radio value="self">{{ $t('docs.workspace.settings.departmentScopeSelf') }}</el-radio>
          <el-radio value="self_and_descendants">{{ $t('docs.workspace.settings.departmentScopeDescendants') }}</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:visible', false)">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" @click="submit" :loading="submitting" :disabled="!userHasDepartment">{{ $t('docs.workspace.home.createCollection') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { modelApi } from '@/api/services'
import { departmentApi } from '@/api/services'
import { useUserStore } from '@/stores/user'
import { useCollectionStore } from '@/stores/collection'
import type { CreateCollectionRequest } from '@/api/collections'
import type { AIModel } from '@/types'

type DepartmentTreeNode = {
  id: string
  name: string
  children?: DepartmentTreeNode[]
}

type FormRuleValidator = (rule: unknown, value: unknown, callback: (error?: Error) => void) => void

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  'created': []
}>()

const userStore = useUserStore()
const collectionStore = useCollectionStore()
const { t } = useI18n()
const formRef = ref<FormInstance>()
const submitting = ref(false)
const embeddingModels = ref<AIModel[]>([])
const departmentTree = ref<DepartmentTreeNode[]>([])
const userHasDepartment = ref(false)

// 没部门的用户无法创建任何集合（后端 createCollection 强制要求 department_id）。
// 提示按角色区分：管理员知道去哪分配部门，普通用户只能找管理员。
const isAdmin = computed(() => userStore.isAdmin)
const deptRequiredHint = computed(() =>
  isAdmin.value
    ? t('docs.workspace.settings.departmentRequiredHintAdmin')
    : t('docs.workspace.settings.departmentRequiredHint')
)

const form = reactive({
  name: '',
  description: '',
  embedding_model_id: '',
  visibility: 'private' as 'private' | 'department' | 'public',
  department_id: '',
  department_scope: 'self' as 'self' | 'self_and_descendants',
})

const rules: FormRules = {
  name: [{ required: true, message: t('docs.workspace.settings.collectionNamePlaceholder'), trigger: 'blur' }],
  embedding_model_id: [{ required: true, message: t('docs.workspace.settings.embeddingModelPlaceholder'), trigger: 'change' }],
  department_id: [{
    required: true,
    message: t('docs.workspace.settings.departmentPlaceholder'),
    trigger: 'change',
    validator: ((_rule, _value, callback) => {
      if (form.visibility === 'department' && !form.department_id) {
        callback(new Error(t('docs.workspace.settings.departmentPlaceholder')))
      } else {
        callback()
      }
    }) as FormRuleValidator,
  }],
}

async function onOpen() {
  form.name = ''
  form.description = ''
  form.embedding_model_id = ''
  form.visibility = 'private'
  form.department_id = ''
  form.department_scope = 'self'
  formRef.value?.resetFields()

  try {
    const models = await modelApi.getModels()
    embeddingModels.value = (models || []).filter(m => m.model_type === 'embedding' && m.is_active)
  } catch (error) {
    console.error('Failed to load embedding models:', error)
  }

  try {
    const tree = await departmentApi.getDepartmentTree()
    departmentTree.value = tree || []
  } catch (error) {
    console.error('Failed to load department tree:', error)
  }

  userHasDepartment.value = !!(userStore.user?.department_id)
}

async function submit() {
  if (!userHasDepartment.value) {
    ElMessage.warning(t('docs.workspace.settings.departmentRequiredHint'))
    return
  }

  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const data: CreateCollectionRequest = {
      name: form.name.trim(),
      embedding_model_id: form.embedding_model_id,
      visibility: form.visibility,
    }
    if (form.description) data.description = form.description.trim()
    if (form.visibility === 'department') {
      data.department_id = form.department_id
      data.department_scope = form.department_scope
    }
    const result = await collectionStore.addCollection(data)
    if (!result) {
      const errMsg = collectionStore.error || ''
      const isServerError = errMsg.includes('database') || errMsg.includes('SQL') || errMsg.includes('constraint')
      ElMessage.error(isServerError ? t('common.error') : (collectionStore.error || t('common.error')))
      return
    }
    emit('created')
    emit('update:visible', false)
  } catch {
    ElMessage.error(t('common.error'))
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.dept-alert-top {
  margin-bottom: 16px;
  padding: 8px 12px;
  align-items: flex-start;
}
</style>
