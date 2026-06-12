<template>
  <div class="collection-detail-view">
    <div class="view-header">
      <el-button text @click="goBack">← 返回集合列表</el-button>
      <div class="header-right">
        <el-upload
          :show-file-list="false"
          :auto-upload="false"
          :on-change="handleFileChange"
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
        >
          <el-button type="primary" :loading="store.isUploadingDocument">上传文档</el-button>
        </el-upload>
        <el-button @click="goSettings">设置</el-button>
      </div>
    </div>

    <div v-if="store.isLoading && !store.currentCollection" class="loading-state">
      {{ $t('common.loading') }}
    </div>

    <template v-else-if="store.currentCollection">
      <div class="collection-info">
        <h1 class="collection-name">{{ store.currentCollection.name }}</h1>
        <p v-if="store.currentCollection.description" class="collection-desc">{{ store.currentCollection.description }}</p>
        <div class="collection-meta">
          <el-tag size="small" :type="visibilityTagType(store.currentCollection.visibility)">
            {{ visibilityLabel(store.currentCollection.visibility) }}
          </el-tag>
          <span>{{ store.currentCollection.doc_count || 0 }} 篇文档</span>
        </div>
      </div>

      <div class="doc-list-section">
        <div class="section-header">
          <h3>文档列表</h3>
        </div>

        <div v-if="store.isLoading && store.collectionDocuments.length === 0" class="loading-state">
          {{ $t('common.loading') }}
        </div>

        <div v-else-if="store.collectionDocuments.length === 0" class="empty-state">
          <p>暂无文档</p>
        </div>

        <div v-else class="doc-table-wrap">
          <el-table :data="store.collectionDocuments" stripe>
            <el-table-column label="文档标题">
              <template #default="{ row }">
                <span class="doc-title-link" @click="openDoc(row.id)">{{ row.title }}</span>
              </template>
            </el-table-column>
            <el-table-column label="上传时间" width="180">
              <template #default="{ row }">
                {{ formatTime(row.source_attachment?.created_at || row.created_at) }}
              </template>
            </el-table-column>
            <el-table-column label="当前版本" width="120">
              <template #default="{ row }">
                <span>{{ row.current_revision?.revision_label || row.current_revision?.revision_no || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="处理状态" width="140">
              <template #default="{ row }">
                <el-tag size="small" :type="processingTagType(row.processing_status)">
                  {{ processingLabel(row.processing_status, row.ocr_status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="OCR Task ID" min-width="260">
              <template #default="{ row }">
                <span class="task-id-text">{{ row.ocr_task_id || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="可预览结果" width="120">
              <template #default="{ row }">
                <el-tag size="small" :type="row.has_preview_result ? 'success' : 'info'">
                  {{ row.has_preview_result ? '已生成' : '暂无' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="danger" link @click.stop="onDeleteDocument(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-wrap" v-if="store.docTotal > store.pageSize">
            <el-pagination
              v-model:current-page="store.docPage"
              :page-size="store.pageSize"
              :total="store.docTotal"
              layout="prev, pager, next"
              @current-change="onDocPageChange"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCollectionStore } from '@/stores/collection'
import { useDocStore } from '@/stores/doc'
import { ElMessage } from 'element-plus'
import { ElMessageBox } from 'element-plus'
import type { UploadFile } from 'element-plus'

const route = useRoute()
const router = useRouter()
const store = useCollectionStore()
const docStore = useDocStore()

const collectionId = route.params.id as string

function visibilityLabel(v: string) {
  const map: Record<string, string> = { private: '私有', department: '部门', public: '公开' }
  return map[v] || v
}

function visibilityTagType(v: string) {
  const map: Record<string, string> = { private: 'info', department: 'warning', public: 'success' }
  return map[v] || 'info'
}

function formatTime(t: string) {
  if (!t) return ''
  return new Date(t).toLocaleString('zh-CN')
}

function processingLabel(status?: string, ocrStatus?: string) {
  if (status === 'pending_ocr') return '待OCR'
  if (status === 'ocr_processing') return ocrStatus === 'completed' ? 'OCR完成' : 'OCR处理中'
  if (status === 'pending_clean') return '待文本清洗'
  if (status === 'ready') return '已就绪'
  if (status === 'error') return '处理失败'
  return status || '未知'
}

function processingTagType(status?: string) {
  if (status === 'ready') return 'success'
  if (status === 'pending_clean') return 'info'
  if (status === 'ocr_processing' || status === 'pending_ocr') return 'warning'
  if (status === 'error') return 'danger'
  return 'info'
}

function goBack() {
  router.push('/docs')
}

function goSettings() {
  router.push(`/docs/collections/${collectionId}/settings`)
}

function openDoc(documentId: string) {
  router.push(`/docs/${documentId}`)
}

async function handleFileChange(uploadFile: UploadFile) {
  const rawFile = uploadFile.raw
  if (!rawFile) return

  const result = await store.uploadDocumentToCollection(collectionId, rawFile)
  if (!result) {
    ElMessage.error(store.error || '上传文档失败')
    return
  }

  ElMessage.success('文档已上传并提交识别')
  router.push(`/docs/${result.intake.document_id}`)
}

async function onDeleteDocument(row: { id: string; title: string }) {
  try {
    await ElMessageBox.confirm(
      `确定删除文档「${row.title}」吗？此操作会同时删除文档记录、OCR结果和附件文件。`,
      '删除文档',
      { type: 'warning' },
    )

    const ok = await docStore.removeDocument(row.id)
    if (!ok) {
      ElMessage.error(docStore.error || '删除文档失败')
      return
    }

    ElMessage.success('文档已删除')
    await store.fetchCollection(collectionId)
    await store.fetchCollectionDocuments(collectionId, { page: store.docPage })
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(docStore.error || '删除文档失败')
  }
}

function onDocPageChange(page: number) {
  store.fetchCollectionDocuments(collectionId, { page })
}

onMounted(async () => {
  await store.fetchCollection(collectionId)
  if (store.currentCollection) {
    await store.fetchCollectionDocuments(collectionId)
  }
})
</script>

<style scoped>
.collection-detail-view { max-width: 960px; margin: 0 auto; padding: 24px; }
.view-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.collection-info { margin-bottom: 32px; }
.collection-name { font-size: 24px; font-weight: 600; margin: 0 0 8px 0; }
.collection-desc { color: #606266; margin: 0 0 12px 0; }
.collection-meta { display: flex; gap: 12px; align-items: center; font-size: 13px; color: #909399; }
.doc-list-section { margin-top: 24px; }
.section-header { margin-bottom: 12px; }
.section-header h3 { margin: 0; font-size: 16px; }
.doc-title-link { color: #409eff; cursor: pointer; }
.doc-title-link:hover { text-decoration: underline; }
.task-id-text { font-family: Consolas, 'Courier New', monospace; font-size: 12px; color: #606266; word-break: break-all; }
.pagination-wrap { margin-top: 16px; display: flex; justify-content: center; }
.loading-state, .empty-state { text-align: center; padding: 40px 0; color: #999; }
</style>
