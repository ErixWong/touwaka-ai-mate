<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ArrowLeft } from '@element-plus/icons-vue'
import { getInvoiceDetail, type InvoiceDetail as InvoiceDetailType } from '@/api/invoice'
import { ElMessage } from 'element-plus'

const props = defineProps<{ rowId: string }>()
const emit = defineEmits<{ back: [] }>()

const loading = ref(false)
const detail = ref<InvoiceDetailType | null>(null)

const statusLabels: Record<string, { label: string; type: string }> = {
  pending_process: { label: '待处理', type: 'info' },
  pending_ocr: { label: 'OCR中', type: 'warning' },
  ocr_submitted: { label: '等待OCR', type: 'warning' },
  pending_review: { label: '待确认', type: '' },
  confirmed: { label: '已确认', type: 'success' },
  extract_failed: { label: '识别失败', type: 'danger' },
  ocr_failed: { label: 'OCR失败', type: 'danger' },
}

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
</script>

<template>
  <div v-loading="loading" class="invoice-detail">
    <div class="detail-header">
      <el-button text @click="emit('back')">
        <el-icon><ArrowLeft /></el-icon>
        返回列表
      </el-button>
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
          <el-table-column prop="quantity" label="数量" width="80" align="right" />
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
          <el-table-column prop="issuer" label="开票人" width="80" />
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
