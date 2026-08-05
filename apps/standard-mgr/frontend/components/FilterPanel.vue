<template>
  <div class="sm-filter-page">
    <div class="sm-filter-bar">
      <el-form :inline="true" :model="filters" size="default" class="sm-filter-form">
        <el-form-item :label="$t('apps.standardMgr.standardType')">
          <el-select
            v-model="filters.standard_type"
            :placeholder="$t('apps.standardMgr.selectTypePlaceholder')"
            clearable
            @change="handleSearch"
          >
            <el-option :label="$t('apps.standardMgr.typeNational')" value="national" />
            <el-option :label="$t('apps.standardMgr.typeIndustry')" value="industry" />
            <el-option :label="$t('apps.standardMgr.typeEnterprise')" value="enterprise" />
            <el-option :label="$t('apps.standardMgr.typeInternational')" value="international" />
          </el-select>
        </el-form-item>

        <el-form-item :label="$t('apps.standardMgr.filterStatus')">
          <el-radio-group v-model="filters.is_active" @change="handleSearch">
            <el-radio-button :value="undefined">{{ $t('common.all') }}</el-radio-button>
            <el-radio-button :value="1">{{ $t('apps.standardMgr.statusActive') }}</el-radio-button>
            <el-radio-button :value="0">{{ $t('apps.standardMgr.statusInactive') }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>

      <el-divider />

      <div class="sm-advanced-filter">
        <el-tag type="warning" size="default">
          <el-icon><Lock /></el-icon>
          {{ $t('apps.standardMgr.comingSoon') }}: {{ $t('apps.standardMgr.advancedFilter') }}
        </el-tag>
      </div>
    </div>

    <div v-loading="loading" class="sm-filter-results">
      <el-empty v-if="!loading && results.length === 0" :description="$t('apps.standardMgr.noFilterResult')" />

      <el-table v-else :data="results" stripe size="small" class="sm-filter-table">
        <el-table-column :label="$t('apps.standardMgr.standardCode')" width="180">
          <template #default="{ row }">{{ row.standard_code }}</template>
        </el-table-column>
        <el-table-column :label="$t('apps.standardMgr.standardName')" min-width="200">
          <template #default="{ row }">{{ row.standard_name }}</template>
        </el-table-column>
        <el-table-column :label="$t('apps.standardMgr.standardType')" width="120">
          <template #default="{ row }">
            <el-tag size="small">{{ row.standard_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('apps.standardMgr.filterStatus')" width="100">
          <template #default="{ row }">
            <el-tag :type="row.is_active ? 'success' : 'info'" size="small">
              {{ row.is_active ? $t('apps.standardMgr.statusActive') : $t('apps.standardMgr.statusInactive') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('apps.standardMgr.manageVersion')" width="120">
          <template #default="{ row }">{{ row.version || '-' }}</template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Lock } from '@element-plus/icons-vue'
import { listStandards, type StandardItem, type StandardType } from '../api/standard-mgr'
import { useToastStore } from '@/stores/toast'
import { i18n } from '@/i18n'

const filters = ref<{
  standard_type?: StandardType
  is_active?: number
}>({
  standard_type: undefined,
  is_active: undefined,
})

const loading = ref(false)
const results = ref<StandardItem[]>([])

async function handleSearch() {
  loading.value = true
  try {
    const params: any = {}
    if (filters.value.standard_type) params.standard_type = filters.value.standard_type
    if (filters.value.is_active !== undefined) params.is_active = filters.value.is_active
    results.value = await listStandards(params)
  } catch {
    results.value = []
    useToastStore().error(i18n.global.t('apps.standardMgr.loadListFailed'))
  } finally {
    loading.value = false
  }
}

onMounted(() => { handleSearch() })
</script>

<style scoped>
.sm-filter-page { padding: 16px 20px; }
.sm-filter-bar { margin-bottom: 16px; }
.sm-filter-form { display: flex; flex-wrap: wrap; gap: 8px; }
.sm-advanced-filter { margin: 8px 0; }
.sm-advanced-filter .el-tag { display: inline-flex; align-items: center; gap: 4px; }
.sm-filter-results { min-height: 200px; }
.sm-filter-table { width: 100%; }
</style>
