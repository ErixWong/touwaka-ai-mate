<template>
  <el-dialog
    :model-value="true"
    :title="$t('apps.standardMgr.configTitle')"
    width="680px"
    @close="$emit('close')"
  >
    <el-tabs v-model="activeTab">
      <!-- ========== Tab 1: 模型配置 ========== -->
      <el-tab-pane :label="$t('apps.standardMgr.configTabModel')" name="model">
        <el-form :model="form" label-width="140px" @submit.prevent>
          <el-form-item :label="$t('apps.standardMgr.configLLMModel')">
            <el-select
              v-model="form.llm_model_id"
              :placeholder="$t('apps.standardMgr.configLLMPlaceholder')"
              clearable
              filterable
              style="width: 100%"
            >
              <el-option :label="$t('apps.standardMgr.configUseDefault')" :value="null" />
              <el-option
                v-for="m in models"
                :key="m.id"
                :label="`${m.model_name} (${m.provider_name || ''})`"
                :value="m.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item :label="$t('apps.standardMgr.configTemperature')">
            <el-input-number v-model="form.temperature" :min="0" :max="2" :step="0.1" />
          </el-form-item>

          <div class="config-help-text">
            {{ $t('apps.standardMgr.configHelpText') }}
          </div>
        </el-form>
      </el-tab-pane>

      <!-- ========== Tab 2: 企业管理 ========== -->
      <el-tab-pane :label="$t('apps.standardMgr.enterpriseTab')" name="enterprise">
        <div class="enterprise-toolbar">
          <span class="enterprise-help-text">{{ $t('apps.standardMgr.enterpriseHelpText') }}</span>
          <el-button type="primary" size="small" @click="openCreate">
            {{ $t('apps.standardMgr.newEnterprise') }}
          </el-button>
        </div>

        <el-table :data="enterprises" v-loading="enterprisesLoading" size="small" style="width: 100%">
          <el-table-column :label="$t('apps.standardMgr.enterpriseColName')" prop="name" min-width="110" />
          <el-table-column :label="$t('apps.standardMgr.enterpriseColPrefixes')" min-width="180">
            <template #default="{ row }">
              <el-tag v-if="row.code_prefixes" size="small" type="info" class="prefix-tag">
                {{ row.code_prefixes }}
              </el-tag>
              <span v-else class="no-prefix">{{ $t('apps.standardMgr.enterpriseNoPrefix') }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('apps.standardMgr.enterpriseColCount')" width="80" align="center">
            <template #default="{ row }">{{ row.standard_count ?? 0 }}</template>
          </el-table-column>
          <el-table-column :label="$t('apps.standardMgr.enterpriseColStatus')" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.is_active ? 'success' : 'info'" size="small">
                {{ row.is_active ? $t('apps.standardMgr.statusActive') : $t('apps.standardMgr.statusInactive') }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="$t('apps.standardMgr.enterpriseColAction')" width="140" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openEdit(row)">
                {{ $t('apps.standardMgr.enterpriseEdit') }}
              </el-button>
              <el-button
                v-if="row.is_active"
                link
                type="danger"
                size="small"
                @click="onDeactivate(row)"
              >
                {{ $t('apps.standardMgr.enterpriseDeactivate') }}
              </el-button>
              <el-button v-else link type="primary" size="small" @click="onActivate(row)">
                {{ $t('apps.standardMgr.enterpriseActivate') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="$emit('close')">{{ $t('apps.standardMgr.cancel') }}</el-button>
      <el-button v-if="activeTab === 'model'" type="primary" :loading="saving" @click="onSave">
        {{ $t('apps.standardMgr.save') }}
      </el-button>
    </template>

    <!-- 新建 / 编辑企业对话框 -->
    <el-dialog
      :model-value="enterpriseDialogVisible"
      :title="editingEnterprise ? $t('apps.standardMgr.enterpriseEditTitle') : $t('apps.standardMgr.enterpriseCreateTitle')"
      width="480px"
      append-to-body
      @close="enterpriseDialogVisible = false"
    >
      <el-form :model="enterpriseForm" label-width="110px" @submit.prevent>
        <el-form-item :label="$t('apps.standardMgr.enterpriseColName')" required>
          <el-input v-model="enterpriseForm.name" :placeholder="$t('apps.standardMgr.enterpriseNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('apps.standardMgr.enterpriseColPrefixes')">
          <el-input
            v-model="enterpriseForm.code_prefixes"
            :placeholder="$t('apps.standardMgr.enterprisePrefixPlaceholder')"
          />
          <div class="enterprise-field-help">{{ $t('apps.standardMgr.enterprisePrefixHelp') }}</div>
        </el-form-item>
        <el-form-item :label="$t('apps.standardMgr.enterpriseColNameEn')">
          <el-input v-model="enterpriseForm.name_en" :placeholder="$t('apps.standardMgr.enterpriseNameEnPlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('apps.standardMgr.enterpriseColDesc')">
          <el-input v-model="enterpriseForm.description" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="enterpriseDialogVisible = false">{{ $t('apps.standardMgr.cancel') }}</el-button>
        <el-button type="primary" :loading="enterpriseSaving" @click="onSaveEnterprise">
          {{ $t('apps.standardMgr.save') }}
        </el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import { modelApi } from '@/api/services'
import type { AIModel } from '@/types'
import { useToastStore } from '@/stores/toast'
import { i18n } from '@/i18n'
import {
  getConfig,
  saveConfig,
  listEnterprises,
  createEnterprise,
  updateEnterprise,
  deleteEnterprise,
  type StandardMgrConfig,
  type EnterpriseItem,
} from '../api/standard-mgr'

const props = defineProps<{ config: StandardMgrConfig | null }>()
const emit = defineEmits<{
  close: []
  saved: [config: StandardMgrConfig]
}>()

const toast = useToastStore()

// ── 模型配置 tab ──
const activeTab = ref('model')
const form = reactive<StandardMgrConfig>({
  llm_model_id: props.config?.llm_model_id ?? null,
  temperature: props.config?.temperature ?? 0,
})
const models = ref<AIModel[]>([])
const saving = ref(false)

// ── 企业管理 tab ──
const enterprises = ref<EnterpriseItem[]>([])
const enterprisesLoading = ref(false)
const enterpriseDialogVisible = ref(false)
const enterpriseSaving = ref(false)
const editingEnterprise = ref<EnterpriseItem | null>(null)
const enterpriseForm = reactive({
  name: '',
  code_prefixes: '',
  name_en: '',
  description: '',
})

onMounted(async () => {
  try {
    const all = await modelApi.getModels()
    models.value = (all || []).filter(
      m => m.is_active !== false && (m.model_type === 'text' || m.model_type === 'multimodal'),
    )
  } catch {
    // 模型列表加载失败不阻塞弹窗
  }
  await loadEnterprises()
})

watch(
  () => props.config,
  config => {
    if (config) {
      form.llm_model_id = config.llm_model_id ?? null
      form.temperature = config.temperature ?? 0
    }
  },
  { immediate: true },
)

async function onSave() {
  saving.value = true
  try {
    const saved = await saveConfig({ ...form })
    toast.success(i18n.global.t('apps.standardMgr.configSaved'))
    emit('saved', saved)
    emit('close')
  } catch (err: any) {
    toast.error(err?.message || i18n.global.t('apps.standardMgr.configSaveFailed'))
  } finally {
    saving.value = false
  }
}

// ── 企业操作 ──
async function loadEnterprises() {
  enterprisesLoading.value = true
  try {
    enterprises.value = await listEnterprises()
  } catch (err: any) {
    toast.error(err?.message || i18n.global.t('apps.standardMgr.loadEnterprisesFailed'))
  } finally {
    enterprisesLoading.value = false
  }
}

function openCreate() {
  editingEnterprise.value = null
  enterpriseForm.name = ''
  enterpriseForm.code_prefixes = ''
  enterpriseForm.name_en = ''
  enterpriseForm.description = ''
  enterpriseDialogVisible.value = true
}

function openEdit(row: EnterpriseItem) {
  editingEnterprise.value = row
  enterpriseForm.name = row.name
  enterpriseForm.code_prefixes = row.code_prefixes || ''
  enterpriseForm.name_en = row.name_en || ''
  enterpriseForm.description = row.description || ''
  enterpriseDialogVisible.value = true
}

async function onSaveEnterprise() {
  const name = enterpriseForm.name.trim()
  if (!name) {
    toast.error(i18n.global.t('apps.standardMgr.enterpriseNameRequired'))
    return
  }
  enterpriseSaving.value = true
  try {
    const data = {
      name,
      code_prefixes: enterpriseForm.code_prefixes.trim() || null,
      name_en: enterpriseForm.name_en.trim() || null,
      description: enterpriseForm.description.trim() || null,
    }
    if (editingEnterprise.value) {
      await updateEnterprise(editingEnterprise.value.id, data)
      toast.success(i18n.global.t('apps.standardMgr.enterpriseUpdated'))
    } else {
      await createEnterprise(data)
      toast.success(i18n.global.t('apps.standardMgr.enterpriseCreated'))
    }
    enterpriseDialogVisible.value = false
    await loadEnterprises()
  } catch (err: any) {
    toast.error(err?.message || i18n.global.t('apps.standardMgr.enterpriseCreateFailed'))
  } finally {
    enterpriseSaving.value = false
  }
}

async function onDeactivate(row: EnterpriseItem) {
  try {
    await ElMessageBox.confirm(
      i18n.global.t('apps.standardMgr.enterpriseDeactivateConfirm', { name: row.name }),
      i18n.global.t('apps.standardMgr.enterpriseDeactivateTitle'),
      { type: 'warning', confirmButtonText: i18n.global.t('apps.standardMgr.confirm'), cancelButtonText: i18n.global.t('apps.standardMgr.cancel') },
    )
  } catch {
    return // 用户取消
  }
  try {
    await deleteEnterprise(row.id)
    toast.success(i18n.global.t('apps.standardMgr.enterpriseDeactivated'))
    await loadEnterprises()
  } catch (err: any) {
    toast.error(err?.message || i18n.global.t('apps.standardMgr.enterpriseDeactivateFailed'))
  }
}

async function onActivate(row: EnterpriseItem) {
  try {
    await updateEnterprise(row.id, { is_active: true })
    toast.success(i18n.global.t('apps.standardMgr.enterpriseActivated'))
    await loadEnterprises()
  } catch (err: any) {
    toast.error(err?.message || i18n.global.t('apps.standardMgr.enterpriseActivateFailed'))
  }
}
</script>

<style scoped>
.config-help-text {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.enterprise-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.enterprise-help-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.prefix-tag {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-prefix {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.enterprise-field-help {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
