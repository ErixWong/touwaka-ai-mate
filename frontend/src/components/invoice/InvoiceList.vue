<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { listInvoices, exportInvoices, type InvoiceRow, type InvoiceListParams } from '@/api/invoice'
import { uploadAttachmentFormData } from '@/api/attachment'
import { batchUpload, deleteRecord } from '@/api/mini-apps'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ElTable } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import InvoiceDetail from './InvoiceDetail.vue'
import { statusLabels } from '@/utils/invoice-status-labels'

const APP_ID = 'invoice-mgr'
const MAX_BATCH_SIZE = 10

const loading = ref(false)
const invoices = ref<InvoiceRow[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const showDetail = ref(false)
const selectedRowId = ref('')
const showCreateDialog = ref(false)
const creating = ref(false)
const selectedFiles = ref<File[]>([])
const selectedRows = ref<InvoiceRow[]>([])
const deleting = ref(false)
const exporting = ref(false)
const tableRef = ref<InstanceType<typeof ElTable>>()

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
  sort: 'created_at',
  order: 'desc',
})

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
  filters.value = { page: 1, size: 20, sort: 'created_at', order: 'desc' }
  dateMode.value = ''
  dateValue.value = null
  page.value = 1
  loadList()
}

function openCreateDialog() {
  selectedFiles.value = []
  showCreateDialog.value = true
}

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  const newFiles = Array.from(input.files).filter(f => {
    const ext = f.name.split('.').pop()?.toLowerCase()
    return ['pdf', 'jpg', 'jpeg', 'png'].includes(ext || '')
  })
  const total = selectedFiles.value.length + newFiles.length
  if (total > MAX_BATCH_SIZE) {
    ElMessage.warning(`单次最多上传 ${MAX_BATCH_SIZE} 个文件，当前已选 ${selectedFiles.value.length} 个，只能再添加 ${MAX_BATCH_SIZE - selectedFiles.value.length} 个`)
    input.value = ''
    return
  }
  selectedFiles.value = [...selectedFiles.value, ...newFiles]
  input.value = ''
}

function removeFile(index: number) {
  selectedFiles.value.splice(index, 1)
}

async function handleCreate() {
  if (selectedFiles.value.length === 0) {
    ElMessage.warning('请先选择发票文件')
    return
  }
  creating.value = true
  const totalFiles = selectedFiles.value.length
  let uploadedCount = 0
  const attachmentIds: string[] = []

  try {
    // 1) 串行上传附件
    for (const file of selectedFiles.value) {
      try {
        const att = await uploadAttachmentFormData({
          source_tag: 'mini_app_file',
          source_id: APP_ID,
          file,
        })
        attachmentIds.push(att.id)
        uploadedCount++
      } catch (e: any) {
        ElMessage.warning(`${file.name} 上传失败: ${e.message || '未知错误'}`)
      }
    }

    if (attachmentIds.length === 0) {
      ElMessage.error('所有文件上传失败，请检查网络后重试')
      return
    }

    // 2) 批量建单
    const result = await batchUpload(APP_ID, attachmentIds)

    showCreateDialog.value = false
    selectedFiles.value = []
    page.value = 1
    filters.value.page = 1
    await loadList()

    // 3) 结果摘要
    const skipped = result.skipped_count || 0
    const created = result.created_count || 0
    if (skipped > 0) {
      ElMessage.success(
        `已选择 ${totalFiles} 个文件，附件上传成功 ${uploadedCount} 个，` +
        `发票记录创建成功 ${created} 个，跳过 ${skipped} 个。正在识别中`
      )
    } else if (uploadedCount < totalFiles) {
      ElMessage.success(
        `附件上传成功 ${uploadedCount}/${totalFiles} 个，已创建 ${created} 条发票记录。正在识别中`
      )
    } else {
      ElMessage.success(`已创建 ${created} 条发票记录，正在识别中`)
    }
  } catch (e: any) {
    ElMessage.error(e.message || '创建失败')
  } finally {
    creating.value = false
  }
}

function handleSelectionChange(rows: InvoiceRow[]) {
  selectedRows.value = rows
}

async function handleBatchDelete() {
  if (selectedRows.value.length === 0) return
  const count = selectedRows.value.length
  const hasProcessing = selectedRows.value.some(r => r.status?.startsWith('pending_'))

  try {
    await ElMessageBox.confirm(
      hasProcessing
        ? `将删除 ${count} 条发票记录（其中包含正在分析中的记录），删除后不可恢复。确认继续？`
        : `将删除 ${count} 条发票记录，删除后不可恢复。确认继续？`,
      '批量删除确认',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 用户取消
  }

  deleting.value = true
  let successCount = 0
  let failCount = 0
  const failedInvoices: string[] = []
  const rowIds = selectedRows.value.map(r => r.id)

  try {
    for (const id of rowIds) {
      try {
        await deleteRecord(APP_ID, id)
        successCount++
      } catch (e: any) {
        failCount++
        const label = selectedRows.value.find(r => r.id === id)?.invoice_number || id
        failedInvoices.push(label)
        console.error(`删除 ${label} 失败:`, e.message || e)
      }
    }

    // 清空选择态（显式清除表格勾选 UI + 本地状态）
    tableRef.value?.clearSelection()
    selectedRows.value = []
    await loadList()

    // 当前页全删后自动回退，避免停留在空页
    if (invoices.value.length === 0 && page.value > 1) {
      page.value -= 1
      filters.value.page = page.value
      await loadList()
    }

    // 结果摘要
    if (failCount === 0) {
      ElMessage.success(`已成功删除 ${successCount} 条记录`)
    } else {
      const detail = failedInvoices.slice(0, 3).join('、') + (failedInvoices.length > 3 ? '等' : '')
      ElMessage.warning(`删除完成：成功 ${successCount} 条，失败 ${failCount} 条（${detail}），请刷新后核对`)
    }
  } catch (e: any) {
    ElMessage.error(e.message || '批量删除异常')
  } finally {
    deleting.value = false
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
            <el-button type="danger" :disabled="selectedRows.length === 0" :loading="deleting" @click="handleBatchDelete">
              批量删除（{{ selectedRows.length }}）
            </el-button>
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

      <el-table ref="tableRef" :data="invoices" v-loading="loading" stripe @row-click="onRowClick" @selection-change="handleSelectionChange" style="cursor:pointer">
        <el-table-column type="selection" width="50" />
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
        <div class="create-file-list" v-if="selectedFiles.length > 0">
          <div class="create-file-count">
            已选择 {{ selectedFiles.length }} 个文件（上限 {{ MAX_BATCH_SIZE }} 个）
          </div>
          <div v-for="(f, idx) in selectedFiles" :key="idx" class="create-file-item">
            <span class="create-file-name">{{ f.name }}</span>
            <el-button size="small" text type="danger" @click="removeFile(idx)">移除</el-button>
          </div>
        </div>
        <label class="create-file-trigger">
          <span>{{ selectedFiles.length > 0 ? '继续添加文件' : '选择发票文件' }}</span>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple @change="handleFileSelect" class="hidden-input" />
        </label>
        <div class="create-file-hint">支持 PDF、JPG、JPEG、PNG，单次最多 {{ MAX_BATCH_SIZE }} 个；创建后自动识别发票信息</div>
      </div>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="selectedFiles.length === 0" @click="handleCreate">
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

.create-file-list {
  margin-bottom: 12px;
}

.create-file-count {
  color: var(--el-color-primary);
  font-size: 13px;
  margin-bottom: 8px;
}

.create-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
}

.create-file-item + .create-file-item {
  border-top: 1px solid var(--el-border-color-lighter);
}

.create-file-name {
  color: var(--el-text-color-primary);
  word-break: break-all;
  font-size: 13px;
}

.create-file-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
  cursor: pointer;
}

.create-file-trigger:hover {
  background: var(--el-fill-color);
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
