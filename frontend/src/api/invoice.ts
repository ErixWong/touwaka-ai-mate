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
  issuer: string
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
