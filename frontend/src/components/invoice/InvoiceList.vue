<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { listInvoices, exportInvoices, type InvoiceRow, type InvoiceListParams } from '@/api/invoice'
import { uploadAttachmentFormData } from '@/api/attachment'
import { createRecord, newID } from '@/api/mini-apps'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import InvoiceDetail from './InvoiceDetail.vue'

const APP_ID = 'invoice-mgr'

const loading = ref(false)
const invoices = ref<InvoiceRow[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const showDetail = ref(false)
const selectedRowId = ref('')
const showCreateDialog = ref(false)
const creating = ref(false)
const selectedFile = ref<File | null>(null)
const exporting = ref(false)

// 日期筛选
const dateMode = ref<'year' | 'month' | 'day' | ''>('')
const dateValue = ref<any>(null)

// 个性化导出
const showExportDialog = ref(false)
const exportSelectedFields = ref<string[]>([
  'invoice_number', 'invoice_date', 'invoice_type', 'status',
  'seller_name', 'seller_tax_id', 'buyer_name', 'buyer_tax_id',
  'total_amount', 'total_tax', 'total_with_tax',
  'remarks', 'issuer', 'ocr_method', 'extraction_status',
])
const exportIncludeItems = ref(true)

// ⚠️ 字段定义需与后端 ALL_HEADER_FIELDS (invoice.service.js exportCustom) 保持同步
const exportFieldGroups = [
  {
    label: '基本信息',
    fields: [
      { key: 'invoice_number', label: '发票号码' },
      { key: 'invoice_date', label: '开票日期' },
      { key: 'invoice_type', label: '发票类型' },
      { key: 'status', label: '状态' },
    ],
  },
  {
    label: '交易方',
    fields: [
      { key: 'seller_name', label: '销售方名称' },
      { key: 'seller_tax_id', label: '销售方税号' },
      { key: 'buyer_name', label: '购买方名称' },
      { key: 'buyer_tax_id', label: '购买方税号' },
    ],
  },
  {
    label: '金额',
    fields: [
      { key: 'total_amount', label: '合计金额' },
      { key: 'total_tax', label: '税额' },
      { key: 'total_with_tax', label: '价税合计' },
    ],
  },
  {
    label: '其他',
    fields: [
      { key: 'remarks', label: '备注' },
      { key: 'issuer', label: '开票人' },
      { key: 'ocr_method', label: '识别方式' },
      { key: 'extraction_status', label: '提取状态' },
    ],
  },
]

const filters = ref<InvoiceListParams>({
  page: 1,
  size: 20,
  sort: 'invoice_date',
  order: 'desc',
})

const statusLabels: Record<string, { label: string; type: string }> = {
  pending_process: { label: '待处理', type: 'info' },
  pending_vl_extract: { label: 'VL提取中', type: 'warning' },
  pending_review: { label: '待确认', type: '' },
  confirmed: { label: '已确认', type: 'success' },
  extract_failed: { label: '识别失败', type: 'danger' },
}

onMounted(() => {
  loadList()
})

function buildDateFilter(): { start_date?: string; end_date?: string } {
  if (!dateMode.value || !dateValue.value) return {}
  if (dateMode.value === 'year') {
    const y = String(dateValue.value)
    return { start_date: `${y}-01-01`, end_date: `${y}-12-31` }
  }
  if (dateMode.value === 'month') {
    const [start, end] = dateValue.value
    // end 是 YYYY-MM，取当月最后一天
    const [ey, em] = end.split('-').map(Number)
    const lastDay = new Date(ey, em, 0).getDate()
    return { start_date: `${start}-01`, end_date: `${end}-${String(lastDay).padStart(2, '0')}` }
  }
  if (dateMode.value === 'day') {
    const [start, end] = dateValue.value
    return { start_date: start, end_date: end }
  }
  return {}
}

async function loadList() {
  loading.value = true
  try {
    const dateFilter = buildDateFilter()
    const params = { ...filters.value, ...dateFilter }
    const result = await listInvoices(params)
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
  dateMode.value = ''
  dateValue.value = null
  page.value = 1
  loadList()
}

function openCreateDialog() {
  selectedFile.value = null
  showCreateDialog.value = true
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) {
    selectedFile.value = input.files[0]!
  }
  input.value = ''
}

function clearFile() {
  selectedFile.value = null
}

async function handleCreate() {
  if (!selectedFile.value) {
    ElMessage.warning('请先选择发票文件')
    return
  }
  creating.value = true
  try {
    const file = selectedFile.value
    const att = await uploadAttachmentFormData({
      source_tag: 'mini_app_file',
      source_id: APP_ID,
      file,
    })

    const clientId = await newID(20)
    await createRecord(APP_ID, {}, [att.id], clientId)

    showCreateDialog.value = false
    selectedFile.value = null
    page.value = 1
    filters.value.page = 1
    await loadList()
    ElMessage.success('发票已创建，正在识别中')
  } catch (e: any) {
    ElMessage.error(e.message || '创建失败')
  } finally {
    creating.value = false
  }
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

async function onDeleted() {
  showDetail.value = false
  selectedRowId.value = ''
  await loadList()
}

async function handleExport(type: 'full' | 'custom' | 'negative') {
  if (type === 'custom') {
    showExportDialog.value = true
    return
  }
  await doExport(type)
}

async function handleConfirmExport() {
  if (exportSelectedFields.value.length === 0) {
    ElMessage.warning('请至少选择一列')
    return
  }
  showExportDialog.value = false
  await doExport('custom')
}

async function doExport(type: 'full' | 'custom' | 'negative') {
  exporting.value = true
  try {
    const dateFilter = buildDateFilter()
    const params: any = {
      type,
      ...dateFilter,
      sort: filters.value.sort,
      order: filters.value.order,
      invoice_number: filters.value.invoice_number,
      seller_name: filters.value.seller_name,
      buyer_name: filters.value.buyer_name,
      status: filters.value.status,
    }
    if (type === 'custom') {
      params.fields = exportSelectedFields.value
      params.include_items = exportIncludeItems.value
    }
    await exportInvoices(params)
    ElMessage.success('导出成功')
  } catch (e: any) {
    // 后端返回 JSON 错误时，blob 解析出消息
    if (e.response?.data instanceof Blob) {
      const text = await e.response.data.text()
      try {
        const json = JSON.parse(text)
        ElMessage.error(json.message || '导出失败')
      } catch {
        ElMessage.error('导出失败')
      }
    } else {
      ElMessage.error(e.message || '导出失败')
    }
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="invoice-page">
    <div v-if="!showDetail" class="invoice-list-view">
      <div class="page-header">
        <h2>🧾 发票管理</h2>
      </div>

      <div class="filter-bar">
        <div class="filter-row">
          <div class="filter-left">
            <el-input v-model="filters.invoice_number" placeholder="发票号码" clearable style="width:180px" />
            <el-input v-model="filters.seller_name" placeholder="销售方" clearable style="width:160px" />
            <el-input v-model="filters.buyer_name" placeholder="购买方" clearable style="width:160px" />
            <el-select v-model="filters.status" placeholder="状态" clearable style="width:120px">
              <el-option v-for="(v, k) in statusLabels" :key="k" :label="v.label" :value="k" />
            </el-select>
          </div>
          <div class="filter-right">
            <el-button type="primary" @click="onSearch">搜索</el-button>
            <el-button @click="onReset">重置</el-button>
            <el-button type="primary" @click="openCreateDialog">
              + 新增发票
            </el-button>
            <el-dropdown trigger="click" @command="handleExport">
              <el-button :loading="exporting">
                导出 <el-icon><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="full">全部导出</el-dropdown-item>
                  <el-dropdown-item command="custom">个性化导出</el-dropdown-item>
                  <el-dropdown-item command="negative">负值导出</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>

        <div class="filter-row filter-date-row">
          <el-radio-group v-model="dateMode" size="small" @change="dateValue = null">
            <el-radio-button value="year">按年</el-radio-button>
            <el-radio-button value="month">按月</el-radio-button>
            <el-radio-button value="day">按日</el-radio-button>
          </el-radio-group>

          <span v-if="dateMode === 'year'" style="flex:none">
            <el-date-picker
              v-model="dateValue"
              type="year"
              placeholder="选择年份"
              value-format="YYYY"
              style="width:140px"
            />
          </span>
          <span v-if="dateMode === 'month'" style="flex:none">
            <el-date-picker
              v-model="dateValue"
              type="monthrange"
              start-placeholder="开始月份"
              end-placeholder="结束月份"
              format="YYYY-MM"
              value-format="YYYY-MM"
              style="width:230px"
            />
          </span>
          <span v-if="dateMode === 'day'" style="flex:none">
            <el-date-picker
              v-model="dateValue"
              type="daterange"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              format="YYYY-MM-DD"
              value-format="YYYY-MM-DD"
              style="width:230px"
            />
          </span>
        </div>
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
      <InvoiceDetail :row-id="selectedRowId" @back="onBack" @deleted="onDeleted" />
    </div>

    <el-dialog v-model="showCreateDialog" title="新增发票" width="520px" destroy-on-close>
      <div class="create-file-upload">
        <div v-if="selectedFile" class="create-file-selected">
          <span class="create-file-name">{{ selectedFile.name }}</span>
          <el-button size="small" text type="danger" @click="clearFile">移除</el-button>
        </div>
        <label v-else class="create-file-trigger">
          <span>选择发票文件</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" @change="handleFileSelect" class="hidden-input" />
        </label>
        <div class="create-file-hint">支持 PDF、JPG、JPEG、PNG；创建后自动识别发票信息</div>
      </div>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="!selectedFile" @click="handleCreate">
          创建并上传
        </el-button>
      </template>
    </el-dialog>

    <!-- 个性化导出弹窗 -->
    <el-dialog v-model="showExportDialog" title="个性化导出" width="560px" destroy-on-close>
      <div class="export-field-groups">
        <div v-for="group in exportFieldGroups" :key="group.label" class="export-group">
          <div class="export-group-label">{{ group.label }}</div>
          <el-checkbox-group v-model="exportSelectedFields">
            <el-checkbox v-for="f in group.fields" :key="f.key" :value="f.key" :label="f.key">
              {{ f.label }}
            </el-checkbox>
          </el-checkbox-group>
        </div>
        <div class="export-group">
          <div class="export-group-label">商品明细</div>
          <el-checkbox v-model="exportIncludeItems">
            包含商品明细（生成第二个 Sheet）
          </el-checkbox>
        </div>
      </div>
      <template #footer>
        <el-button @click="showExportDialog = false">取消</el-button>
        <el-button type="primary" :loading="exporting" @click="handleConfirmExport">
          导出 Excel
        </el-button>
      </template>
    </el-dialog>
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
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.filter-row {
  display: flex;
  gap: 12px;
  align-items: center;
}

.filter-left {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  flex: 1;
}

.filter-right {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-left: auto;
  flex-shrink: 0;
}

.pagination-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.create-file-upload {
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  padding: 16px;
}

.create-file-selected {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.create-file-name {
  color: var(--el-text-color-primary);
  word-break: break-all;
}

.create-file-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
  cursor: pointer;
}

.create-file-hint {
  margin-top: 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.hidden-input {
  display: none;
}

.export-field-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.export-group-label {
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
  font-size: 14px;
}

.export-group :deep(.el-checkbox) {
  margin-right: 16px;
  margin-bottom: 4px;
}
</style>
