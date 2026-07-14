/**
 * 发票管理共享状态标签映射
 * 供 InvoiceList.vue、InvoiceDetail.vue 等组件统一引用
 *
 * ⚠️ 新增状态时只需修改此文件，所有引用组件自动同步
 */

export interface StatusLabel {
  label: string
  type: 'info' | 'warning' | 'success' | 'danger' | ''
}

export const statusLabels: Record<string, StatusLabel> = {
  pending_process: { label: '待处理', type: 'info' },
  pending_vl_extract: { label: 'VL提取中', type: 'warning' },
  pending_review: { label: '待确认', type: '' },
  confirmed: { label: '已确认', type: 'success' },
  extract_failed: { label: '识别失败', type: 'danger' },
  duplicate: { label: '重复发票', type: 'warning' },
}

export function getStatusLabel(status: string): StatusLabel {
  return statusLabels[status] || { label: status, type: 'info' }
}
