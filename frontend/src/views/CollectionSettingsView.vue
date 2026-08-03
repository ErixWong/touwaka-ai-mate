<template>
  <div class="collection-settings">
    <div class="settings-breadcrumb">
      <router-link to="/docs" class="breadcrumb-link">{{ $t('docs.workspace.detail.breadcrumb.platform') }}</router-link>
      <span class="breadcrumb-sep">/</span>
      <router-link :to="`/docs/collections/${collectionId}`" class="breadcrumb-link">{{ store.currentCollection?.name || $t('docs.workspace.collection.collectionName') }}</router-link>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">{{ $t('docs.workspace.settings.settings') }}</span>
    </div>

    <div v-if="store.isLoading && !store.currentCollection" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <template v-else-if="store.currentCollection">
      <h2 class="settings-heading">{{ $t('docs.workspace.settings.heading') }}</h2>

      <div class="settings-section">
        <h3 class="section-title">{{ $t('docs.workspace.settings.basicInfo') }}</h3>
        <el-form ref="formRef" :model="form" label-width="110px" class="settings-form">
          <el-form-item :label="$t('docs.workspace.settings.collectionName')">
            <el-input v-model="form.name" maxlength="100" show-word-limit />
          </el-form-item>
          <el-form-item :label="$t('docs.workspace.settings.description')">
            <el-input v-model="form.description" type="textarea" maxlength="500" show-word-limit :rows="3" />
          </el-form-item>
        </el-form>
      </div>

      <div class="settings-section">
        <h3 class="section-title">{{ $t('docs.workspace.settings.permissionScope') }}</h3>
        <el-form ref="permFormRef" :model="form" label-width="110px" class="settings-form">
          <el-form-item :label="$t('docs.workspace.settings.visibility')">
            <el-radio-group v-model="form.visibility">
              <el-radio value="private">{{ $t('docs.workspace.settings.visibilityPrivate') }}</el-radio>
              <el-radio value="department">{{ $t('docs.workspace.settings.visibilityDepartment') }}</el-radio>
              <el-radio value="public">{{ $t('docs.workspace.settings.visibilityPublic') }}</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="form.visibility === 'department'" :label="$t('docs.workspace.settings.department')">
            <el-tree-select
              v-model="form.department_id"
              :data="departmentTree"
              :props="{ label: 'name', value: 'id', children: 'children' }"
              :placeholder="$t('docs.workspace.settings.departmentPlaceholder')"
              check-strictly
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item v-if="form.visibility === 'department'" :label="$t('docs.workspace.settings.departmentScope')">
            <el-radio-group v-model="form.department_scope">
              <el-radio value="self">{{ $t('docs.workspace.settings.departmentScopeSelf') }}</el-radio>
              <el-radio value="self_and_descendants">{{ $t('docs.workspace.settings.departmentScopeDescendants') }}</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
      </div>

      <div class="settings-section">
        <h3 class="section-title">{{ $t('docs.workspace.settings.advanced') }}</h3>
        <el-form ref="advancedFormRef" :model="form" label-width="110px" class="settings-form">
          <el-form-item :label="$t('docs.workspace.settings.embeddingModel')">
            <el-select v-model="form.embedding_model_id" :placeholder="$t('docs.workspace.settings.embeddingModelPlaceholder')" style="width: 100%">
              <el-option v-for="m in embeddingModels" :key="m.id" :label="m.name" :value="m.id" />
            </el-select>
            <div class="form-hint">{{ $t('docs.workspace.settings.embeddingHint') }}</div>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveSettings" :loading="saving">{{ $t('docs.workspace.settings.saveSettings') }}</el-button>
          </el-form-item>
        </el-form>
      </div>

      <div class="settings-section">
        <h3 class="section-title">{{ $t('docs.workspace.settings.revectorizeTitle') }}</h3>
        <p class="section-desc">{{ $t('docs.workspace.settings.revectorizeDesc') }}</p>
        <el-button type="warning" @click="doRevectorize" :loading="revectorizing">{{ $t('docs.workspace.settings.revectorizeAction') }}</el-button>
        <p v-if="revectorizeResult" class="action-result">{{ revectorizeResult }}</p>
      </div>

      <div class="settings-section danger-section">
        <h3 class="section-title danger-title">{{ $t('docs.workspace.settings.dangerTitle') }}</h3>
        <p class="section-desc">{{ $t('docs.workspace.settings.deleteDesc') }}</p>
        <el-button
          type="danger"
          @click="doDelete"
          :loading="deleting"
          :disabled="(store.currentCollection.doc_count || 0) > 0"
        >
          {{ $t('docs.workspace.settings.deleteCollection') }}
        </el-button>
        <div v-if="(store.currentCollection.doc_count || 0) > 0" class="form-hint">
          {{ $t('docs.workspace.settings.deleteDisabledHint') }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { modelApi } from '@/api/services'
import { departmentApi } from '@/api/services'
import { useCollectionStore } from '@/stores/collection'
import type { AIModel } from '@/types'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
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
  } catch {
    ElMessage.error(t('docs.workspace.settings.loadModelsFailed'))
  }
  try {
    const tree = await departmentApi.getDepartmentTree()
    departmentTree.value = tree || []
  } catch {
    ElMessage.error(t('docs.workspace.settings.loadDepartmentsFailed'))
  }
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
    revectorizeResult.value = t('docs.workspace.settings.revectorizeResult', { count: result?.revectorized_count || 0 })
  } catch {
    revectorizeResult.value = t('common.operationFailed')
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
