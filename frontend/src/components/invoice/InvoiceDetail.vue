<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ArrowLeft } from '@element-plus/icons-vue'
import { getInvoiceDetail, deleteInvoiceRecord, reExtractInvoiceRecord, type InvoiceDetail as InvoiceDetailType } from '@/api/invoice'
import { ElMessage, ElMessageBox } from 'element-plus'
import { statusLabels } from '@/utils/invoice-status-labels'

const props = defineProps<{ rowId: string }>()
const emit = defineEmits<{ back: []; deleted: [] }>()

const loading = ref(false)
const detail = ref<InvoiceDetailType | null>(null)
const deleting = ref(false)
const reExtracting = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    detail.value = await getInvoiceDetail(props.rowId)
  } catch (e: any) {
    ElMessage.error(e.message || '加载失败')
  } finally {
    loading.value = false
  }
})

function formatQuantity(v: any): string {
  const n = Number(v)
  if (isNaN(n)) return String(v ?? '')
  return n.toFixed(2)
}

async function onDelete() {
  try {
    await ElMessageBox.confirm('删除后不可恢复，是否继续？', '删除发票记录', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }

  deleting.value = true
  try {
    await deleteInvoiceRecord(props.rowId)
    ElMessage.success('记录已删除')
    emit('deleted')
    emit('back')
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

async function onReExtract() {
  const currentStatus = detail.value?.status
  const statusLabel = currentStatus ? (statusLabels[currentStatus]?.label || currentStatus) : '未知'

  try {
    await ElMessageBox.confirm(
      `当前状态为「${statusLabel}」，重新分析将重置为初始状态并重新提取数据，是否继续？`,
      '重新分析发票',
      {
        confirmButtonText: '确认重置',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
  } catch {
    return
  }

  reExtracting.value = true
  try {
    await reExtractInvoiceRecord(props.rowId)
    ElMessage.success('已重置为初始状态，系统将自动重新分析')
    emit('deleted')
    emit('back')
  } catch (e: any) {
    ElMessage.error(e.message || '重置失败')
  } finally {
    reExtracting.value = false
  }
}
</script>

<template>
  <div v-loading="loading" class="invoice-detail">
    <div class="detail-header">
      <el-button text @click="emit('back')">
        <el-icon><ArrowLeft /></el-icon>
        返回列表
      </el-button>
      <div class="header-actions">
        <el-button
          v-if="detail && detail.status !== 'pending_process' && detail.status !== 'pending_vl_extract'"
          type="warning"
          plain
          :loading="reExtracting"
          @click="onReExtract"
        >
          重新分析
        </el-button>
        <el-button type="danger" plain :loading="deleting" @click="onDelete">
          删除记录
        </el-button>
      </div>
    </div>

    <template v-if="detail">
      <div class="detail-card">
        <div class="card-title">
          <span>发票详情</span>
          <el-tag v-if="detail.status" :type="statusLabels[detail.status]?.type || 'info'" size="small">
            {{ statusLabels[detail.status]?.label || detail.status }}
          </el-tag>
        </div>

        <el-descriptions :column="2" border>
          <el-descriptions-item label="发票号码">{{ detail.invoice_number || '-' }}</el-descriptions-item>
          <el-descriptions-item label="开票日期">{{ detail.invoice_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="发票类型">{{ detail.invoice_type || '-' }}</el-descriptions-item>
          <el-descriptions-item label="识别方法">{{ detail.ocr_method || '-' }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ detail.remarks || '-' }}</el-descriptions-item>
          <el-descriptions-item label="开票人">{{ detail.issuer || '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions :column="2" border style="margin-top:16px" title="交易方信息">
          <el-descriptions-item label="销售方名称">{{ detail.seller_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="购买方名称">{{ detail.buyer_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="销售方税号">{{ detail.seller_tax_id || '-' }}</el-descriptions-item>
          <el-descriptions-item label="购买方税号">{{ detail.buyer_tax_id || '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-descriptions :column="3" border style="margin-top:16px" title="金额信息">
          <el-descriptions-item label="合计金额">¥{{ detail.total_amount?.toLocaleString() }}</el-descriptions-item>
          <el-descriptions-item label="税额">¥{{ detail.total_tax?.toLocaleString() }}</el-descriptions-item>
          <el-descriptions-item label="价税合计"><strong>¥{{ detail.total_with_tax?.toLocaleString() }}</strong></el-descriptions-item>
        </el-descriptions>
      </div>

      <div v-if="detail.items && detail.items.length > 0" class="detail-card" style="margin-top:16px">
        <div class="card-title">商品明细 ({{ detail.item_count }} 项)</div>
        <el-table :data="detail.items" stripe size="small">
          <el-table-column type="index" width="50" />
          <el-table-column prop="category" label="分类" width="100" />
          <el-table-column prop="name" label="商品名称" min-width="160" show-overflow-tooltip />
          <el-table-column prop="model" label="规格型号" width="120" show-overflow-tooltip />
          <el-table-column prop="unit" label="单位" width="60" />
          <el-table-column prop="quantity" label="数量" width="80" align="right">
            <template #default="{ row: r }">{{ formatQuantity(r.quantity) }}</template>
          </el-table-column>
          <el-table-column prop="price" label="单价" width="100" align="right">
            <template #default="{ row: r }">¥{{ r.price?.toLocaleString() }}</template>
          </el-table-column>
          <el-table-column prop="amount" label="金额" width="120" align="right">
            <template #default="{ row: r }">¥{{ r.amount?.toLocaleString() }}</template>
          </el-table-column>
          <el-table-column prop="tax_rate" label="税率" width="70" />
          <el-table-column prop="tax_amount" label="税额" width="100" align="right">
            <template #default="{ row: r }">¥{{ r.tax_amount?.toLocaleString() }}</template>
          </el-table-column>
        </el-table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.invoice-detail {
  max-width: 1200px;
}

.detail-header {
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-card {
  background: var(--el-bg-color);
  border-radius: 8px;
  padding: 20px;
  border: 1px solid var(--el-border-color-light);
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
