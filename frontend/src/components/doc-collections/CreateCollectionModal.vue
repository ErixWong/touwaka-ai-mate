<template>
  <el-dialog
    :model-value="props.visible"
    title="新建文档集合"
    width="520px"
    @update:model-value="$emit('update:visible', $event)"
    @open="onOpen"
    :close-on-click-modal="false"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="集合名称" prop="name">
        <el-input v-model="form.name" maxlength="100" show-word-limit placeholder="输入集合名称" />
      </el-form-item>
      <el-form-item label="描述" prop="description">
        <el-input v-model="form.description" type="textarea" maxlength="500" show-word-limit placeholder="可选描述" :rows="3" />
      </el-form-item>
      <el-form-item label="嵌入模型" prop="embedding_model_id">
        <el-select v-model="form.embedding_model_id" placeholder="选择嵌入模型" style="width:100%">
          <el-option v-for="m in embeddingModels" :key="m.id" :label="m.name" :value="m.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="可见范围" prop="visibility">
        <el-radio-group v-model="form.visibility">
          <el-radio value="private">私有</el-radio>
          <el-radio value="department" :disabled="!userHasDepartment">部门</el-radio>
          <el-radio value="public">公开</el-radio>
        </el-radio-group>
        <div v-if="!userHasDepartment && form.visibility === 'department'" class="form-hint">
          请先加入部门后才能创建部门可见集合
        </div>
      </el-form-item>
      <el-form-item v-if="form.visibility === 'department'" label="所属部门" prop="department_id">
        <el-tree-select
          v-model="form.department_id"
          :data="departmentTree"
          :props="{ label: 'name', value: 'id', children: 'children' }"
          placeholder="选择所属部门"
          check-strictly
          style="width:100%"
        />
      </el-form-item>
      <el-form-item v-if="form.visibility === 'department'" label="部门范围" prop="department_scope">
        <el-radio-group v-model="form.department_scope">
          <el-radio value="self">仅本部门</el-radio>
          <el-radio value="self_and_descendants">本部门及下级</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" @click="submit" :loading="submitting">创建</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { modelApi } from '@/api/services'
import { departmentApi } from '@/api/services'
import { useUserStore } from '@/stores/user'
import { useCollectionStore } from '@/stores/collection'
import type { AIModel } from '@/types'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  'created': []
}>()

const userStore = useUserStore()
const collectionStore = useCollectionStore()
const formRef = ref<FormInstance>()
const submitting = ref(false)
const embeddingModels = ref<AIModel[]>([])
const departmentTree = ref<any[]>([])
const userHasDepartment = ref(false)

const form = reactive({
  name: '',
  description: '',
  embedding_model_id: '',
  visibility: 'private' as 'private' | 'department' | 'public',
  department_id: '',
  department_scope: 'self' as 'self' | 'self_and_descendants',
})

const rules: FormRules = {
  name: [{ required: true, message: '请输入集合名称', trigger: 'blur' }],
  embedding_model_id: [{ required: true, message: '请选择嵌入模型', trigger: 'change' }],
  department_id: [{
    required: true,
    message: '请选择所属部门',
    trigger: 'change',
    validator: (_rule: any, _value: any, callback: any) => {
      if (form.visibility === 'department' && !form.department_id) {
        callback(new Error('请选择所属部门'))
      } else {
        callback()
      }
    },
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
  } catch {}

  try {
    const tree = await departmentApi.getDepartmentTree()
    departmentTree.value = tree || []
  } catch {}

  userHasDepartment.value = !!(userStore.user?.department_id)
}

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const data: any = {
      name: form.name.trim(),
      embedding_model_id: form.embedding_model_id,
      visibility: form.visibility,
    }
    if (form.description) data.description = form.description.trim()
    if (form.visibility === 'department') {
      data.department_id = form.department_id
      data.department_scope = form.department_scope
    }
    await collectionStore.addCollection(data)
    emit('created')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.form-hint { font-size: 12px; color: #e6a23c; margin-top: 4px; }
</style>
