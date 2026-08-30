<template>
  <div v-loading="loading" class="sm-gap-aggregate-panel">
    <div class="sm-gap-aggregate-header">
      <h3>{{ $t('apps.standardMgr.gapAggregateTitle') }}</h3>
    </div>

    <el-empty
      v-if="!loading && gapGroups.length === 0"
      :description="$t('apps.standardMgr.noGapAggregate')"
    />

    <el-table
      v-else-if="gapGroups.length > 0"
      :data="gapGroups"
      row-key="code"
      stripe
      class="sm-gap-aggregate-table"
    >
      <el-table-column type="expand" width="48">
        <template #default="{ row }">
          <div class="sm-gap-sources">
            <div class="sm-gap-sources-title">
              {{ $t('apps.standardMgr.gapAggregateSources') }}
            </div>
            <el-table :data="row.referenced_by" size="small" class="sm-gap-source-table">
              <el-table-column
                :label="$t('apps.standardMgr.gapAggregateSourceStandard')"
                min-width="280"
              >
                <template #default="{ row: source }">
                  <el-button
                    link
                    type="primary"
                    :loading="openingStandardId === source.standard_id"
                    @click="openSourceStandard(source.standard_id)"
                  >
                    <span class="sm-source-code">{{ source.standard_code }}</span>
                    <span>{{ source.standard_name }}</span>
                  </el-button>
                </template>
              </el-table-column>
              <el-table-column
                :label="$t('apps.standardMgr.gapAggregateSourceCount')"
                prop="count"
                width="100"
                align="center"
              />
            </el-table>
          </div>
        </template>
      </el-table-column>

      <el-table-column
        :label="$t('apps.standardMgr.gapAggregateCode')"
        prop="code"
        min-width="260"
      >
        <template #default="{ row }">
          <span class="sm-gap-code">{{ row.code }}</span>
        </template>
      </el-table-column>
      <el-table-column
        :label="$t('apps.standardMgr.gapAggregateTotal')"
        prop="total"
        width="110"
        align="center"
      />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { aggregateGaps, type GapAggregateItem } from '../api/standard-mgr'
import { useStandardMgrStore } from '../stores/standardMgr'
import { useToastStore } from '@/stores/toast'
import { i18n } from '@/i18n'

const emit = defineEmits<{
  openStandard: [standardId: string]
}>()

const store = useStandardMgrStore()
const loading = ref(false)
const gapGroups = ref<GapAggregateItem[]>([])
const openingStandardId = ref<string | null>(null)

async function loadGapGroups() {
  loading.value = true
  try {
    gapGroups.value = await aggregateGaps()
  } catch (err: unknown) {
    gapGroups.value = []
    const message = err instanceof Error
      ? err.message
      : i18n.global.t('apps.standardMgr.loadGapAggregateFailed')
    useToastStore().error(message)
  } finally {
    loading.value = false
  }
}

async function openSourceStandard(standardId: string) {
  if (openingStandardId.value) return

  const tabId = store.openTab(standardId)
  if (!tabId) {
    useToastStore().error(i18n.global.t('apps.standardMgr.gapAggregateOpenStandardFailed'))
    return
  }

  openingStandardId.value = standardId
  try {
    await store.loadTabData(standardId)
    store.switchTab(tabId)
    emit('openStandard', standardId)
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : i18n.global.t('apps.standardMgr.gapAggregateOpenStandardFailed')
    useToastStore().error(message)
  } finally {
    openingStandardId.value = null
  }
}

onMounted(() => {
  loadGapGroups()
})
</script>

<style scoped>
.sm-gap-aggregate-panel {
  height: 100%;
  overflow-y: auto;
  padding: 16px 20px;
  box-sizing: border-box;
}

.sm-gap-aggregate-header {
  margin-bottom: 16px;
}

.sm-gap-aggregate-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.sm-gap-aggregate-table {
  width: 100%;
}

.sm-gap-code {
  font-family: monospace;
  word-break: break-word;
}

.sm-gap-sources {
  padding: 4px 16px 8px 48px;
}

.sm-gap-sources-title {
  margin-bottom: 8px;
  color: #606266;
  font-size: 13px;
  font-weight: 600;
}

.sm-gap-source-table {
  width: 100%;
}

.sm-source-code {
  margin-right: 8px;
  font-family: monospace;
}
</style>
