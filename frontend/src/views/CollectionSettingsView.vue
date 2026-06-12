<template>
  <div class="collection-settings">
    <div class="settings-breadcrumb">
      <router-link to="/docs" class="breadcrumb-link">文档平台</router-link>
      <span class="breadcrumb-sep">/</span>
      <router-link :to="`/docs/collections/${collectionId}`" class="breadcrumb-link">{{ store.currentCollection?.name || '集合' }}</router-link>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">设置</span>
    </div>

    <div v-if="store.isLoading && !store.currentCollection" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <template v-else-if="store.currentCollection">
      <h2 class="settings-heading">集合设置</h2>

      <div class="settings-section">
        <h3 class="section-title">基本信息</h3>
        <el-form ref="formRef" :model="form" label-width="110px" class="settings-form">
          <el-form-item label="集合名称">
            <el-input v-model="form.name" maxlength="100" show-word-limit />
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="form.description" type="textarea" maxlength="500" show-word-limit :rows="3" />
          </el-form-item>
        </el-form>
      </div>

      <div class="settings-section">
        <h3 class="section-title">权限与范围</h3>
        <el-form ref="permFormRef" :model="form" label-width="110px" class="settings-form">
          <el-form-item label="可见范围">
            <el-radio-group v-model="form.visibility">
              <el-radio value="private">私有</el-radio>
              <el-radio value="department">部门</el-radio>
              <el-radio value="public">公开</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.visibility === 'department'" label="所属部门">
            <el-tree-select
              v-model="form.department_id"
              :data="departmentTree"
              :props="{ label: 'name', value: 'id', children: 'children' }"
              placeholder="选择所属部门"
              check-strictly
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item v-if="form.visibility === 'department'" label="部门范围">
            <el-radio-group v-model="form.department_scope">
              <el-radio value="self">仅本部门</el-radio>
              <el-radio value="self_and_descendants">本部门及下级</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
      </div>

      <div class="settings-section">
        <h3 class="section-title">高级设置</h3>
        <el-form ref="advancedFormRef" :model="form" label-width="110px" class="settings-form">
          <el-form-item label="嵌入模型">
            <el-select v-model="form.embedding_model_id" placeholder="选择嵌入模型" style="width: 100%">
              <el-option v-for="m in embeddingModels" :key="m.id" :label="m.name" :value="m.id" />
            </el-select>
            <div class="form-hint">修改嵌入模型后需手动重新向量化，否则语义检索可能不准确</div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveSettings" :loading="saving">保存设置</el-button>
          </el-form-item>
        </el-form>
      </div>

      <div class="settings-section">
        <h3 class="section-title">重新向量化</h3>
        <p class="section-desc">当嵌入模型变更后，需要对集合内所有文档重新生成向量索引，以确保语义检索精度。</p>
        <el-button type="warning" @click="doRevectorize" :loading="revectorizing">触发重新向量化</el-button>
        <p v-if="revectorizeResult" class="action-result">{{ revectorizeResult }}</p>
      </div>

      <div class="settings-section danger-section">
        <h3 class="section-title danger-title">危险操作</h3>
        <p class="section-desc">仅可删除空集合，请先移除集合内所有文档后再执行删除操作。</p>
        <el-button
          type="danger"
          @click="doDelete"
          :loading="deleting"
          :disabled="(store.currentCollection.doc_count || 0) > 0"
        >
          删除集合
        </el-button>
        <div v-if="(store.currentCollection.doc_count || 0) > 0" class="form-hint">
          请先移除集合内的所有文档后再删除集合
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { modelApi } from '@/api/services'
import { departmentApi } from '@/api/services'
import { useCollectionStore } from '@/stores/collection'
import type { AIModel } from '@/types'

const route = useRoute()
const router = useRouter()
const store = useCollectionStore()

const collectionId = route.params.id as string
const saving = ref(false)
const deleting = ref(false)
const revectorizing = ref(false)
const revectorizeResult = ref('')
const embeddingModels = ref<AIModel[]>([])
const departmentTree = ref<{ id: string; name: string; children?: unknown[] }[]>([])

const form = reactive({
  name: '',
  description: '',
  embedding_model_id: '',
  visibility: 'private' as 'private' | 'department' | 'public',
  department_id: '',
  department_scope: 'self' as 'self' | 'self_and_descendants',
})

async function loadData() {
  try {
    const models = await modelApi.getModels()
    embeddingModels.value = (models || []).filter(m => m.model_type === 'embedding' && m.is_active)
  } catch {}
  try {
    const tree = await departmentApi.getDepartmentTree()
    departmentTree.value = tree || []
  } catch {}
}

function populateForm() {
  const col = store.currentCollection
  if (!col) return
  form.name = col.name || ''
  form.description = col.description || ''
  form.embedding_model_id = col.embedding_model_id || ''
  form.visibility = col.visibility || 'private'
  form.department_id = col.department_id || ''
  form.department_scope = col.department_scope || 'self'
}

async function saveSettings() {
  saving.value = true
  try {
    await store.editCollection(collectionId, {
      name: form.name.trim(),
      description: (form.description || '').trim() || undefined,
      embedding_model_id: form.embedding_model_id,
      visibility: form.visibility,
      department_id: form.department_id,
      department_scope: form.visibility === 'department' ? form.department_scope : undefined,
    })
  } finally {
    saving.value = false
  }
}

async function doRevectorize() {
  revectorizing.value = true
  revectorizeResult.value = ''
  try {
    const result = await store.revectorize(collectionId)
    revectorizeResult.value = `已触发 ${result?.revectorized_count || 0} 个版本的向量重建`
  } catch {
    revectorizeResult.value = '操作失败'
  } finally {
    revectorizing.value = false
  }
}

async function doDelete() {
  deleting.value = true
  try {
    const ok = await store.removeCollection(collectionId)
    if (ok) {
      router.push('/docs')
    }
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  await store.fetchCollection(collectionId)
  populateForm()
  loadData()
})
</script>

<style scoped>
.collection-settings { max-width: 720px; margin: 0 auto; padding: 24px; }

.settings-breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #909399; margin-bottom: 20px; }
.breadcrumb-sep { color: #c0c4cc; }
.breadcrumb-link { color: #909399; text-decoration: none; }
.breadcrumb-link:hover { color: #409eff; }
.breadcrumb-current { color: #303133; font-weight: 500; }

.settings-heading { font-size: 22px; font-weight: 600; margin: 0 0 24px; }

.settings-section { background: #fff; border: 1px solid #ebeef5; border-radius: 10px; padding: 20px; margin-bottom: 16px; }
.section-title { margin: 0 0 16px; font-size: 16px; font-weight: 600; }
.section-desc { color: #909399; font-size: 13px; margin: 0 0 12px; }

.settings-form { margin-top: 0; }

.form-hint { font-size: 12px; color: #e6a23c; margin-top: 4px; }
.action-result { font-size: 13px; color: #67c23a; margin-top: 8px; }

.danger-section { border-color: #f56c6c33; background: #fef0f0; }
.danger-title { color: #f56c6c; }

.loading-state { text-align: center; padding: 40px 0; color: #999; }

@media (max-width: 640px) {
  .collection-settings { padding: 16px; max-width: none; }
  .settings-section { padding: 16px; }
}
</style>
