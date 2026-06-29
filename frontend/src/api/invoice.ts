import apiClient, { apiRequest } from './client'

export interface InvoiceItem {
  id: string
  page_number: number
  sort_order: number
  category: string
  name: string
  model: string
  unit: string
  quantity: number
  price: number
  amount: number
  tax_rate: string
  tax_amount: number
}

export interface InvoiceRow {
  id: string
  status: string
  created_at: string
  invoice_number: string
  invoice_date: string
  invoice_type: string
  seller_name: string
  seller_tax_id: string
  buyer_name: string
  buyer_tax_id: string
  total_amount: number
  total_tax: number
  total_with_tax: number
  item_count: number
  page_count?: number
  remarks: string
  issuer: string
  ocr_method: string
  extraction_status: string
}

export interface InvoiceDetail extends InvoiceRow {
  items: InvoiceItem[]
}

export interface InvoiceListResult {
  list: InvoiceRow[]
  total: number
  page: number
  size: number
}

export interface InvoiceListParams {
  page?: number
  size?: number
  invoice_number?: string
  seller_name?: string
  buyer_name?: string
  status?: string
  start_date?: string
  end_date?: string
  sort?: string
  order?: string
}

export function listInvoices(params: InvoiceListParams = {}) {
  return apiRequest<InvoiceListResult>(
    apiClient.get('/invoice/list', { params })
  )
}

export function getInvoiceDetail(rowId: string) {
  return apiRequest<InvoiceDetail>(
    apiClient.get(`/invoice/${rowId}`)
  )
}

export interface InvoiceExportParams {
  type?: 'full' | 'custom' | 'negative'
  start_date?: string
  end_date?: string
  sort?: string
  order?: string
  fields?: string[]
  include_items?: boolean
  invoice_number?: string
  seller_name?: string
  buyer_name?: string
  status?: string
}

export async function exportInvoices(params: InvoiceExportParams = {}) {
  // 将 fields 数组序列化为逗号分隔字符串
  const queryParams: Record<string, string | boolean | undefined> = { ...params }
  if (Array.isArray(params.fields)) {
    queryParams.fields = params.fields.join(',')
  }

  const response = await apiClient.get('/invoice/export', {
    params: queryParams,
    responseType: 'blob',
  })

  // 从 Content-Disposition 头提取文件名
  const disposition = response.headers['content-disposition']
  const now = new Date();
  const ts = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  let filename = `发票信息全部导出-${ts}.xlsx`
  if (disposition) {
    let match = disposition.match(/filename\*=UTF-8''(.+)/)
    if (match) {
      filename = decodeURIComponent(match[1])
    } else {
      match = disposition.match(/filename="?([^";\s]+)"?/)
      if (match) {
        filename = decodeURIComponent(match[1])
      }
    }
  }

  // 触发浏览器下载
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}
