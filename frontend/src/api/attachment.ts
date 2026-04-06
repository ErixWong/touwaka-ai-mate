import { apiClient } from './client'

/**
 * 附件信息
 */
export interface Attachment {
  id: string
  filename: string
  mime_type: string
  size: number
  source_tag: string
  source_id: string
  uploader_id: string
  uploader_name?: string
  created_at: string
  token_expires_at?: string
}

/**
 * 附件列表响应
 */
export interface AttachmentListResponse {
  items: Attachment[]
  total: number
  page: number
  size: number
  pages: number
}

/**
 * 附件列表查询参数
 */
export interface AttachmentListParams {
  page?: number
  size?: number
  source_tag?: string
  mime_type?: string
  uploader_id?: string
  start_date?: string
  end_date?: string
}

/**
 * 获取附件列表（管理员）
 */
export const getAttachments = async (params: AttachmentListParams = {}): Promise<AttachmentListResponse> => {
  const response = await apiClient.get('/api/attachments', { params })
  return response.data
}

/**
 * 获取附件元数据
 */
export const getAttachmentMeta = async (id: string): Promise<Attachment> => {
  const response = await apiClient.get(`/api/attachments/${id}/meta`)
  return response.data
}

/**
 * 删除附件（管理员）
 */
export const deleteAttachment = async (id: string): Promise<void> => {
  await apiClient.delete(`/api/attachments/${id}`)
}

/**
 * 生成附件访问 Token
 */
export const generateAttachmentToken = async (sourceTag: string, sourceId: string): Promise<{ token: string; expires_at: string }> => {
  const response = await apiClient.post('/api/attachments/token', {
    source_tag: sourceTag,
    source_id: sourceId,
  })
  return response.data
}

/**
 * 获取附件访问 URL
 */
export const getAttachmentUrl = (id: string, token: string): string => {
  return `/attach/t/${token}/${id}`
}