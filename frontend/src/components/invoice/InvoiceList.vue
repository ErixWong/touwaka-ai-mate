<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { listInvoices, type InvoiceRow, type InvoiceListParams } from '@/api/invoice'
import { ElMessage } from 'element-plus'
import InvoiceDetail from './InvoiceDetail.vue'

const APP_ID = 'invoice-mgr'

const loading = ref(false)
const invoices = ref<InvoiceRow[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const showDetail = ref(false)
const selectedRowId = ref('')

const filters = ref<InvoiceListParams>({
  page: 1,
  size: 20,
  sort: 'invoice_date',
  order: 'desc',
})

const statusLabels: Record<string, { label: string; type: string }> = {
  pending_process: { label: '待处理', type: 'info' },
  pending_vl: { label: 'VL识别中', type: 'warning' },
  pending_review: { label: '待确认', type: '' },
  confirmed: { label: '已确认', type: 'success' },
  extract_failed: { label: '识别失败', type: 'danger' },
  not_invoice: { label: '非发票', type: 'danger' },
  duplicate: { label: '已存在', type: 'warning' },
}

onMounted(() => {
  loadList()
})

async function loadList() {
  loading.value = true
  try {
    const result = await listInvoices(filters.value)
    invoices.value = result.list
    total.value = result.total
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  filters.value.page = 1
  loadList()
}

function onReset() {
  filters.value = { page: 1, size: 20, sort: 'invoice_date', order: 'desc' }
  page.value = 1
  loadList()
}

function onPageChange(p: number) {
  page.value = p
  filters.value.page = p
  loadList()
}

function onRowClick(row: InvoiceRow) {
  selectedRowId.value = row.id
  showDetail.value = true
}

function onBack() {
  showDetail.value = false
  selectedRowId.value = ''
}
</script>

<template>
  <div class="invoice-page">
    <div v-if="!showDetail" class="invoice-list-view">
      <div class="page-header">
        <h2>🧾 发票管理</h2>
      </div>

      <div class="filter-bar">
        <el-input v-model="filters.invoice_number" placeholder="发票号码" clearable style="width:180px" />
        <el-input v-model="filters.seller_name" placeholder="销售方" clearable style="width:160px" />
        <el-input v-model="filters.buyer_name" placeholder="购买方" clearable style="width:160px" />
        <el-select v-model="filters.status" placeholder="状态" clearable style="width:120px">
          <el-option v-for="(v, k) in statusLabels" :key="k" :label="v.label" :value="k" />
        </el-select>
        <el-button type="primary" @click="onSearch">搜索</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>

      <el-table :data="invoices" v-loading="loading" stripe @row-click="onRowClick" style="cursor:pointer">
        <el-table-column prop="invoice_number" label="发票号码" width="200" />
        <el-table-column prop="invoice_date" label="开票日期" width="120" />
        <el-table-column prop="invoice_type" label="发票类型" width="180" show-overflow-tooltip />
        <el-table-column prop="seller_name" label="销售方" min-width="150" show-overflow-tooltip />
        <el-table-column prop="buyer_name" label="购买方" min-width="150" show-overflow-tooltip />
        <el-table-column prop="total_with_tax" label="价税合计" width="140" align="right">
          <template #default="{ row }">¥{{ row.total_with_tax?.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="statusLabels[row.status]?.type || 'info'" size="small">
              {{ statusLabels[row.status]?.label || row.status }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          :page-size="size"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="onPageChange"
        />
      </div>
    </div>

    <div v-else class="invoice-detail-view">
      <InvoiceDetail :row-id="selectedRowId" @back="onBack" />
    </div>
  </div>
</template>

<style scoped>
.invoice-page {
  padding: 20px;
  height: 100%;
  overflow-y: auto;
}

.page-header {
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
}

.filter-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.pagination-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
