<template>
  <div class="contract-mgr-page">
    <div class="cm-toolbar">
      <h3>销售合同管理</h3>
      <span class="cm-total">共 {{ total }} 条</span>
    </div>

    <div class="cm-status-bar">
      <span
        v-for="s in statuses"
        :key="s.key"
        :class="['cm-status-chip', { active: status === s.key }]"
        @click="status = status === s.key ? '' : s.key"
      >
        {{ s.label }}
        <em>{{ summary[s.key] || 0 }}</em>
      </span>
      <el-input
        v-model="search"
        placeholder="搜索合同编号/甲方/乙方"
        clearable
        size="small"
        style="width: 240px; margin-left: auto;"
        @input="loadList"
      />
    </div>

    <el-table :data="list" v-loading="loading" stripe size="small" @row-click="openDetail">
      <el-table-column prop="contract_number" label="合同编号" width="180" />
      <el-table-column prop="party_a" label="甲方" min-width="160" />
      <el-table-column prop="party_b" label="乙方" min-width="160" />
      <el-table-column prop="contract_amount" label="金额" width="120" />
      <el-table-column prop="status" label="状态" width="130">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="170">
        <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-if="total > 0"
      v-model:current-page="page"
      :page-size="size"
      :total="total"
      layout="prev, pager, next"
      @current-change="loadList"
      style="margin-top: 12px; justify-content: center;"
    />

    <el-drawer v-model="drawer" title="合同详情" size="500px">
      <template v-if="detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="合同编号">{{ detail.contract_number }}</el-descriptions-item>
          <el-descriptions-item label="甲方">{{ detail.party_a }}</el-descriptions-item>
          <el-descriptions-item label="乙方">{{ detail.party_b }}</el-descriptions-item>
          <el-descriptions-item label="上级公司">{{ detail.parent_company }}</el-descriptions-item>
          <el-descriptions-item label="金额">{{ detail.contract_amount }}</el-descriptions-item>
          <el-descriptions-item label="签订日期">{{ detail.contract_date }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(detail.status)">{{ detail.status }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="处理步骤">{{ detail.process_step }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="detail.extract_json" style="margin-top: 16px;">
          <h4>提取结果</h4>
          <pre class="cm-json">{{ JSON.stringify(detail.extract_json, null, 2) }}</pre>
        </div>

        <div v-if="detail.sections" style="margin-top: 16px;">
          <h4>章节结构</h4>
          <pre class="cm-json">{{ JSON.stringify(detail.sections, null, 2) }}</pre>
        </div>

        <div style="margin-top: 20px; display: flex; gap: 8px;">
          <el-button
            v-if="detail.status === 'pending_review'"
            type="success"
            @click="doConfirm"
          >
            确认入库
          </el-button>
          <el-button
            v-if="['ocr_failed','clean_failed','extract_failed','section_failed'].includes(detail.status)"
            type="warning"
            @click="doRetry"
          >
            重试
          </el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import apiClient, { apiRequest } from '@/api/client'
import { ElMessage } from 'element-plus'

interface ContractRecord {
  id: string; status: string; created_at: string; updated_at: string;
  contract_number?: string; party_a?: string; party_b?: string;
  parent_company?: string; contract_amount?: string; contract_date?: string;
  process_step?: string; extract_json?: any; sections?: any;
}

const APP_ID = 'contract-mgr'
const BASE = `/api/apps/${APP_ID}`

const list = ref<ContractRecord[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const size = ref(20)
const status = ref('')
const search = ref('')
const summary = ref<Record<string, number>>({})

const drawer = ref(false)
const detail = ref<ContractRecord | null>(null)

const statuses = [
  { key: 'pending_ocr', label: '待OCR' },
  { key: 'ocr_processing', label: 'OCR中' },
  { key: 'pending_clean', label: '待清洗' },
  { key: 'cleaning', label: '清洗中' },
  { key: 'pending_extract', label: '待提取' },
  { key: 'pending_section', label: '待章节' },
  { key: 'pending_review', label: '待审核' },
  { key: 'confirmed', label: '已确认' },
]

function statusType(s: string) {
  if (s === 'confirmed') return 'success'
  if (s?.endsWith('_failed')) return 'danger'
  if (s?.endsWith('_processing') || s === 'cleaning') return 'warning'
  return 'info'
}

function formatDate(d: string) {
  return d ? new Date(d).toLocaleString() : ''
}

async function loadList() {
  loading.value = true
  try {
    const params: Record<string, string> = { page: String(page.value), size: String(size.value) }
    if (status.value) params.status = status.value
    if (search.value) params.search = search.value
    const r = await apiRequest<{ list: ContractRecord[], total: number }>(apiClient.get(`${BASE}/records`, { params }))
    list.value = r.list || []
    total.value = r.total || 0
  } finally {
    loading.value = false
  }
}

async function loadSummary() {
  try {
    const r = await apiRequest<{ summary: Record<string, number> }>(apiClient.get(`${BASE}/status-summary`))
    summary.value = r.summary || {}
  } catch {}
}

async function openDetail(row: ContractRecord) {
  try {
    detail.value = await apiRequest<ContractRecord>(apiClient.get(`${BASE}/records/${row.id}`))
    drawer.value = true
  } catch {}
}

async function doConfirm() {
  if (!detail.value) return
  try {
    await apiRequest(apiClient.post(`${BASE}/records/${detail.value.id}/confirm`))
    ElMessage.success('已确认')
    drawer.value = false
    await loadList()
    await loadSummary()
  } catch {}
}

async function doRetry() {
  if (!detail.value) return
  try {
    const r = await apiRequest<{ previous: string, current: string }>(apiClient.post(`${BASE}/records/${detail.value.id}/retry`))
    ElMessage.success(`重试: ${r.previous} → ${r.current}`)
    drawer.value = false
    await loadList()
    await loadSummary()
  } catch {}
}

onMounted(() => { loadList(); loadSummary() })
</script>

<style scoped>
.contract-mgr-page { padding: 16px; max-width: 1200px; margin: 0 auto; }
.cm-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.cm-toolbar h3 { margin: 0; }
.cm-total { color: #909399; font-size: 13px; }
.cm-status-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; align-items: center; }
.cm-status-chip { padding: 2px 10px; border-radius: 12px; border: 1px solid #ddd; font-size: 12px; cursor: pointer; transition: .2s; }
.cm-status-chip:hover { border-color: #409eff; }
.cm-status-chip.active { background: #409eff; color: #fff; border-color: #409eff; }
.cm-status-chip em { font-style: normal; margin-left: 4px; opacity: .7; }
.cm-json { background: #f5f7fa; padding: 12px; border-radius: 4px; font-size: 12px; overflow-x: auto; max-height: 300px; }
</style>
