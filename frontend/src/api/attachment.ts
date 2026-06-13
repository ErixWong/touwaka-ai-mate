import apiClient from './client'

export type AccessLevel = 'public' | 'private'

export interface Attachment {
  id: string
  filename: string
  mime_type: string
  size: number
  source_tag: string
  source_id: string
  uploader_id: string
  uploader_name?: string
  access_level: AccessLevel
  preview_url: string | null
  download_url: string | null
  expires_at?: string | null
  created_at: string
}

export interface AttachmentListResponse {
  items: Attachment[]
  total: number
  page: number
  size: number
  pages: number
}

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

export const getAttachments = async (params: AttachmentListParams = {}): Promise<AttachmentListResponse> => {
  const response = await apiClient.get('/attachments/admin', { params })
  return response.data.data
}

export const getAttachmentMeta = async (id: string): Promise<Attachment> => {
  const response = await apiClient.get(`/attachments/${id}`)
  return response.data.data
}

export const getAttachmentContentUrl = (id: string): string => {
  return `/api/attachments/${id}/content`
}

export const deleteAttachment = async (id: string): Promise<void> => {
  await apiClient.delete(`/attachments/${id}`)
}

export const generateAttachmentToken = async (sourceTag: string, sourceId: string): Promise<{ token: string; url: string; expires_at: string }> => {
  const response = await apiClient.post('/attachments/token', {
    source_tag: sourceTag,
    source_id: sourceId,
  })
  return response.data.data
}

export const getAttachmentUrl = (id: string, token: string): string => {
  return `/attach/t/${token}/${id}`
}

export const getPublicAttachmentUrl = (id: string): string => {
  return `/attach/public/${id}`
}

export interface UploadAttachmentFormDataParams {
  source_tag: string
  source_id: string
  file: File
  alt_text?: string
  access_level?: AccessLevel
}

export interface UploadAttachmentResponse {
  id: string
  source_tag: string
  source_id: string
  file_name: string | null
  mime_type: string
  file_size: number
  width: number | null
  height: number | null
  access_level: AccessLevel
  preview_url: string | null
  download_url: string | null
  expires_at?: string | null
  ref: string
  created_at: string
}

export const uploadAttachmentFormData = async (params: UploadAttachmentFormDataParams): Promise<UploadAttachmentResponse> => {
  const formData = new FormData()
  formData.append('file', params.file)
  formData.append('source_tag', params.source_tag)
  formData.append('source_id', params.source_id)
  if (params.alt_text) {
    formData.append('alt_text', params.alt_text)
  }
  if (params.access_level) {
    formData.append('access_level', params.access_level)
  }
  const response = await apiClient.post('/attachments/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
  return response.data.data
}

export const getAttachmentContent = async (id: string): Promise<Blob> => {
  const response = await apiClient.get(`/attachments/${id}/content`, {
    responseType: 'blob',
  })
  return response.data
}

export const resolveAttachmentDisplayUrl = (attachment: Attachment): string | null => {
  if (attachment.access_level === 'public') {
    return `/attach/public/${attachment.id}`
  }
  return attachment.preview_url || attachment.download_url || null
}
