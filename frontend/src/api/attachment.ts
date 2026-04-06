import apiClient from './client'

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
  source_id?: string
  mime_type?: string
  uploader_id?: string
  start_date?: string
  end_date?: string
}

/**
 * 获取附件列表（管理员）
 */
export const getAttachments = async (params: AttachmentListParams = {}): Promise<AttachmentListResponse> => {
  const response = await apiClient.get('/attachments/admin', { params })
  return response.data.data
}

/**
 * 获取附件元数据
 */
export const getAttachmentMeta = async (id: string): Promise<Attachment> => {
  const response = await apiClient.get(`/attachments/${id}/meta`)
  return response.data.data
}

/**
 * 删除附件（管理员）
 */
export const deleteAttachment = async (id: string): Promise<void> => {
  await apiClient.delete(`/attachments/${id}`)
}

/**
 * 生成附件访问 Token
 */
export const generateAttachmentToken = async (sourceTag: string, sourceId: string): Promise<{ token: string; expires_at: string }> => {
  const response = await apiClient.post('/attachments/token', {
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

/**
 * 上传附件参数
 */
export interface UploadAttachmentParams {
  source_tag: string
  source_id: string
  file_name: string
  mime_type: string
  base64_data: string
  alt_text?: string
}

/**
 * 上传附件响应
 */
export interface UploadAttachmentResponse {
  id: string
  source_tag: string
  source_id: string
  file_name: string | null
  mime_type: string
  file_size: number
  width: number | null
  height: number | null
  file_path: string
  data_url: string
  ref: string
  created_at: string
}

/**
 * 上传附件
 */
export const uploadAttachment = async (params: UploadAttachmentParams): Promise<UploadAttachmentResponse> => {
  const response = await apiClient.post('/attachments', params)
  return response.data.data
}
