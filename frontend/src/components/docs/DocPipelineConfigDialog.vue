<template>
  <el-dialog
    v-model="visible"
    title="文档预处理配置"
    width="960px"
    :close-on-click-modal="false"
    @open="onOpen"
    @close="onClose"
  >
    <div class="pipeline-config">
      <div class="pipeline-nav">
        <div
          v-for="stage in stages"
          :key="stage.key"
          class="nav-item"
          :class="{ active: activeStage === stage.key }"
          @click="activeStage = stage.key"
        >
          <span class="nav-label">{{ stage.label }}</span>
          <span class="nav-key">{{ stage.key }}</span>
        </div>
      </div>

      <div class="pipeline-form">
        <el-form :model="form" label-width="130px" size="small">
          <!-- pending_ocr -->
          <template v-if="activeStage === 'pending_ocr'">
            <el-form-item label="启用"><el-switch v-model="form.pending_ocr.enabled" disabled /></el-form-item>
            <el-form-item label="执行方式"><el-tag size="small" type="info">mcp（固定）</el-tag></el-form-item>
            <el-divider content-position="left">MCP 配置</el-divider>
            <el-form-item label="MCP 服务">
              <el-select v-model="form.pending_ocr.mcp.server" placeholder="选择 MCP 服务" clearable filterable>
                <el-option v-for="s in mcpServers" :key="s.id" :label="s.name" :value="s.name" />
              </el-select>
            </el-form-item>
            <el-form-item label="提交工具名">
              <el-input v-model="form.pending_ocr.mcp.tool" placeholder="create_task_from_file" />
            </el-form-item>
            <el-form-item label="Provider 标识">
              <el-input v-model="form.pending_ocr.provider_name" placeholder="mineru" />
            </el-form-item>
            <el-form-item label="超时(ms)">
              <el-input-number v-model="form.pending_ocr.timeout_ms" :min="5000" :step="10000" />
            </el-form-item>
            <el-divider content-position="left">参数映射</el-divider>
            <el-form-item label="file_base64">
              <el-input v-model="form.pending_ocr.mcp.params_mapping.file_base64" placeholder="file_base64" />
            </el-form-item>
            <el-form-item label="file_name">
              <el-input v-model="form.pending_ocr.mcp.params_mapping.file_name" placeholder="file_name" />
            </el-form-item>
            <el-form-item label="lang">
              <el-input v-model="form.pending_ocr.mcp.params_mapping.lang" placeholder="lang" />
            </el-form-item>
            <el-form-item label="formula_enable">
              <el-input v-model="form.pending_ocr.mcp.params_mapping.formula_enable" placeholder="formula_enable" />
            </el-form-item>
            <el-form-item label="table_enable">
              <el-input v-model="form.pending_ocr.mcp.params_mapping.table_enable" placeholder="table_enable" />
            </el-form-item>
            <el-form-item label="image_analysis">
              <el-input v-model="form.pending_ocr.mcp.params_mapping.image_analysis" placeholder="image_analysis" />
            </el-form-item>
            <el-divider content-position="left">LLM 归一化</el-divider>
            <el-form-item label="归一化模型">
              <el-select v-model="form.pending_ocr.judge.model_id" placeholder="默认模型" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="温度">
              <el-input-number v-model="form.pending_ocr.judge.temperature" :min="0" :max="2" :step="0.1" />
            </el-form-item>
            <el-form-item label="归一化提示词">
              <el-input v-model="form.pending_ocr.judge.prompt_template" type="textarea" :rows="4" />
            </el-form-item>
            <el-form-item label="输出 Schema (JSON)">
              <el-input
                :model-value="schemaJson(form.pending_ocr.judge.output_schema)"
                type="textarea" :rows="4"
                @update:model-value="onSchemaInput($event, 'pending_ocr')"
                placeholder='{"task_id":"string","provider":"string","is_success":true,"message":"string"}'
              />
              <span v-if="schemaError['pending_ocr']" class="schema-error">{{ schemaError['pending_ocr'] }}</span>
            </el-form-item>
          </template>

          <!-- ocr_processing -->
          <template v-if="activeStage === 'ocr_processing'">
            <el-form-item label="启用"><el-switch v-model="form.ocr_processing.enabled" disabled /></el-form-item>
            <el-form-item label="执行方式"><el-tag size="small" type="info">mcp（固定）</el-tag></el-form-item>
            <el-divider content-position="left">MCP 配置</el-divider>
            <el-form-item label="MCP 服务">
              <el-select v-model="form.ocr_processing.mcp.server" placeholder="选择 MCP 服务" clearable filterable>
                <el-option v-for="s in mcpServers" :key="s.id" :label="s.name" :value="s.name" />
              </el-select>
            </el-form-item>
            <el-form-item label="查询工具名">
              <el-input v-model="form.ocr_processing.mcp.tool" placeholder="get_task_status" />
            </el-form-item>
            <el-form-item label="轮询间隔(ms)">
              <el-input-number v-model="form.ocr_processing.poll_interval_ms" :min="1000" :step="1000" />
            </el-form-item>
            <el-form-item label="超时(ms)">
              <el-input-number v-model="form.ocr_processing.timeout_ms" :min="5000" :step="10000" />
            </el-form-item>
            <el-divider content-position="left">LLM 归一化</el-divider>
            <el-form-item label="归一化模型">
              <el-select v-model="form.ocr_processing.judge.model_id" placeholder="默认模型" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="温度">
              <el-input-number v-model="form.ocr_processing.judge.temperature" :min="0" :max="2" :step="0.1" />
            </el-form-item>
            <el-form-item label="归一化提示词">
              <el-input v-model="form.ocr_processing.judge.prompt_template" type="textarea" :rows="4" />
            </el-form-item>
            <el-form-item label="输出 Schema (JSON)">
              <el-input
                :model-value="schemaJson(form.ocr_processing.judge.output_schema)"
                type="textarea" :rows="4"
                @update:model-value="onSchemaInput($event, 'ocr_processing')"
                placeholder='{"status":"pending|processing|completed|failed","progress":0,"is_completed":false,"error_message":"string"}'
              />
              <span v-if="schemaError['ocr_processing']" class="schema-error">{{ schemaError['ocr_processing'] }}</span>
            </el-form-item>
          </template>

          <!-- ocr_finalize -->
          <template v-if="activeStage === 'ocr_finalize'">
            <el-form-item label="启用"><el-switch v-model="form.ocr_finalize.enabled" disabled /></el-form-item>
            <el-divider content-position="left">MCP 配置</el-divider>
            <el-form-item label="MCP 服务">
              <el-select v-model="form.ocr_finalize.mcp.server" placeholder="选择 MCP 服务" clearable filterable>
                <el-option v-for="s in mcpServers" :key="s.id" :label="s.name" :value="s.name" />
              </el-select>
            </el-form-item>
            <el-divider content-position="left">产物工具</el-divider>
            <el-form-item label="默认主产物工具">
              <el-input v-model="form.ocr_finalize.default_deliverable_tool" placeholder="get_default_deliverable" />
            </el-form-item>
            <el-form-item label="交付物列表工具">
              <el-input v-model="form.ocr_finalize.list_deliverables_tool" placeholder="list_deliverables" />
            </el-form-item>
            <el-form-item label="图片产物工具">
              <el-input v-model="form.ocr_finalize.image_deliverables_tool" placeholder="get_image_deliverables" />
            </el-form-item>
            <el-form-item label="超时(ms)">
              <el-input-number v-model="form.ocr_finalize.timeout_ms" :min="5000" :step="10000" />
            </el-form-item>
            <el-form-item label="持久化原始结果">
              <el-switch v-model="form.ocr_finalize.persist_raw_result" />
            </el-form-item>
            <el-form-item label="持久化图片附件">
              <el-switch v-model="form.ocr_finalize.persist_image_attachments" />
            </el-form-item>
            <el-divider content-position="left">LLM 归一化</el-divider>
            <el-form-item label="归一化模型">
              <el-select v-model="form.ocr_finalize.judge.model_id" placeholder="默认模型" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="温度">
              <el-input-number v-model="form.ocr_finalize.judge.temperature" :min="0" :max="2" :step="0.1" />
            </el-form-item>
            <el-form-item label="归一化提示词">
              <el-input v-model="form.ocr_finalize.judge.prompt_template" type="textarea" :rows="4" />
            </el-form-item>
            <el-form-item label="输出 Schema (JSON)">
              <el-input
                :model-value="schemaJson(form.ocr_finalize.judge.output_schema)"
                type="textarea" :rows="4"
                @update:model-value="onSchemaInput($event, 'ocr_finalize')"
                placeholder='{"main_markdown":"string","deliverables":[],"is_success":true,"error_message":"string"}'
              />
              <span v-if="schemaError['ocr_finalize']" class="schema-error">{{ schemaError['ocr_finalize'] }}</span>
            </el-form-item>
          </template>

          <!-- pending_clean -->
          <template v-if="activeStage === 'pending_clean'">
            <el-form-item label="启用"><el-switch v-model="form.pending_clean.enabled" /></el-form-item>
            <el-form-item label="执行方式">
              <el-select v-model="form.pending_clean.type">
                <el-option label="内置 LLM" value="internal_llm" />
                <el-option label="脚本" value="script" />
                <el-option label="禁用" value="disabled" />
              </el-select>
            </el-form-item>
            <el-form-item label="模型">
              <el-select v-model="form.pending_clean.model_id" placeholder="默认模型" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="温度">
              <el-input-number v-model="form.pending_clean.temperature" :min="0" :max="2" :step="0.1" />
            </el-form-item>
            <el-form-item label="分块最大长度">
              <el-input-number v-model="form.pending_clean.chunk_max_length" :min="500" :step="500" />
            </el-form-item>
            <el-form-item label="清洗提示词">
              <el-input v-model="form.pending_clean.prompt_template" type="textarea" :rows="4" />
            </el-form-item>
            <el-divider content-position="left">清洗规则</el-divider>
            <el-form-item label="移除页码"><el-switch v-model="form.pending_clean.rules.remove_page_number" /></el-form-item>
            <el-form-item label="移水印"><el-switch v-model="form.pending_clean.rules.remove_watermark" /></el-form-item>
            <el-form-item label="移除乱码"><el-switch v-model="form.pending_clean.rules.remove_garbled_text" /></el-form-item>
            <el-form-item label="移除页眉页脚"><el-switch v-model="form.pending_clean.rules.remove_header_footer" /></el-form-item>
            <el-form-item label="超时(ms)">
              <el-input-number v-model="form.pending_clean.timeout_ms" :min="5000" :step="10000" />
            </el-form-item>
          </template>

          <!-- pending_metadata -->
          <template v-if="activeStage === 'pending_metadata'">
            <el-form-item label="启用"><el-switch v-model="form.pending_metadata.enabled" /></el-form-item>
            <el-form-item label="执行方式">
              <el-select v-model="form.pending_metadata.type">
                <el-option label="内置 LLM" value="internal_llm" />
                <el-option label="禁用" value="disabled" />
              </el-select>
            </el-form-item>
            <el-form-item label="模型">
              <el-select v-model="form.pending_metadata.model_id" placeholder="默认模型" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="温度">
              <el-input-number v-model="form.pending_metadata.temperature" :min="0" :max="2" :step="0.1" />
            </el-form-item>
            <el-form-item label="元数据提示词">
              <el-input v-model="form.pending_metadata.prompt_template" type="textarea" :rows="4" />
            </el-form-item>
            <el-form-item label="超时(ms)">
              <el-input-number v-model="form.pending_metadata.timeout_ms" :min="5000" :step="10000" />
            </el-form-item>
          </template>

          <!-- pending_chunk -->
          <template v-if="activeStage === 'pending_chunk'">
            <el-form-item label="启用"><el-switch v-model="form.pending_chunk.enabled" /></el-form-item>
            <el-form-item label="分块模式">
              <el-select v-model="form.pending_chunk.chunk_mode">
                <el-option label="按标题" value="heading" />
                <el-option label="按段落" value="paragraph" />
                <el-option label="固定长度" value="fixed" />
                <el-option label="混合策略" value="mixed" />
              </el-select>
            </el-form-item>
            <el-form-item label="最大长度">
              <el-input-number v-model="form.pending_chunk.max_length" :min="100" :step="100" />
            </el-form-item>
            <el-form-item label="重叠长度">
              <el-input-number v-model="form.pending_chunk.overlap_length" :min="0" :step="50" />
            </el-form-item>
            <el-form-item label="保留标题"><el-switch v-model="form.pending_chunk.keep_heading" /></el-form-item>
            <el-form-item label="合并小块"><el-switch v-model="form.pending_chunk.merge_small_chunks" /></el-form-item>
          </template>

          <!-- pending_embedding -->
          <template v-if="activeStage === 'pending_embedding'">
            <el-form-item label="启用"><el-switch v-model="form.pending_embedding.enabled" /></el-form-item>
            <el-form-item label="嵌入模型">
              <el-select v-model="form.pending_embedding.embedding_model_id" placeholder="默认模型" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="批处理大小">
              <el-input-number v-model="form.pending_embedding.batch_size" :min="1" :step="5" />
            </el-form-item>
            <el-form-item label="跳过空块"><el-switch v-model="form.pending_embedding.skip_empty_chunks" /></el-form-item>
            <el-form-item label="重试次数">
              <el-input-number v-model="form.pending_embedding.retry_times" :min="0" :max="10" :step="1" />
            </el-form-item>
            <el-form-item label="超时(ms)">
              <el-input-number v-model="form.pending_embedding.timeout_ms" :min="5000" :step="10000" />
            </el-form-item>
          </template>

          <!-- pending_relocate -->
          <template v-if="activeStage === 'pending_relocate'">
            <el-form-item label="启用"><el-switch v-model="form.pending_relocate.enabled" /></el-form-item>
            <el-form-item label="入库策略">
              <el-select v-model="form.pending_relocate.target_strategy">
                <el-option label="当前集合" value="current_collection" />
                <el-option label="指定集合" value="specified_collection" />
                <el-option label="自动路由" value="auto_route" />
              </el-select>
            </el-form-item>
            <el-form-item label="标签策略">
              <el-select v-model="form.pending_relocate.tag_strategy">
                <el-option label="不写入" value="none" />
                <el-option label="自动标签" value="auto" />
                <el-option label="手动标签" value="manual" />
              </el-select>
            </el-form-item>
            <el-form-item label="元数据回写"><el-switch v-model="form.pending_relocate.metadata_writeback" /></el-form-item>
            <el-form-item label="自动发布"><el-switch v-model="form.pending_relocate.auto_publish" /></el-form-item>
          </template>
        </el-form>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="resetStage">恢复默认</el-button>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { docPipelineApi, type DocPipelineConfig } from '@/api/doc-pipeline'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
}>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, (v) => { visible.value = v })
watch(visible, (v) => { emit('update:modelValue', v) })

const stages = [
  { key: 'pending_ocr', label: 'OCR提交' },
  { key: 'ocr_processing', label: 'OCR轮询' },
  { key: 'ocr_finalize', label: 'OCR产物提取' },
  { key: 'pending_clean', label: '文本清洗' },
  { key: 'pending_metadata', label: '元数据提取' },
  { key: 'pending_chunk', label: '文本分块' },
  { key: 'pending_embedding', label: '向量化' },
  { key: 'pending_relocate', label: '入库收尾' },
]

const activeStage = ref('pending_ocr')
const saving = ref(false)
const loading = ref(false)
const schemaError = ref<Record<string, string>>({})

const defaultForm: DocPipelineConfig = {
  meta: { version: 1, enabled: true },
  pending_ocr: {
    enabled: true, type: 'mcp', provider_name: 'mineru', timeout_ms: 120000,
    mcp: { server: 'mineru', tool: 'create_task_from_file', params_mapping: { file_base64: 'file_base64', file_name: 'file_name', lang: 'lang', formula_enable: 'formula_enable', table_enable: 'table_enable', image_analysis: 'image_analysis' }, params: {} },
    judge: { model_id: null, temperature: 0.1, prompt_template: '', output_schema: {} },
  },
  ocr_processing: {
    enabled: true, type: 'mcp', timeout_ms: 120000, poll_interval_ms: 5000,
    mcp: { server: 'mineru', tool: 'get_task_status', params_mapping: { task_id: 'task_id' }, params: {} },
    judge: { model_id: null, temperature: 0.1, prompt_template: '', output_schema: {} },
  },
  ocr_finalize: {
    enabled: true, mcp: { server: 'mineru' },
    default_deliverable_tool: 'get_default_deliverable', list_deliverables_tool: 'list_deliverables', image_deliverables_tool: 'get_image_deliverables',
    download_deliverable_tool: null, persist_raw_result: true, persist_image_attachments: true, timeout_ms: 120000,
    judge: { model_id: null, temperature: 0.1, prompt_template: '', output_schema: {} },
  },
  pending_clean: {
    enabled: true, type: 'internal_llm', model_id: null, temperature: 0.3, chunk_max_length: 8000, prompt_template: '', timeout_ms: 120000,
    rules: { remove_page_number: true, remove_watermark: true, remove_garbled_text: true, remove_header_footer: true },
  },
  pending_metadata: { enabled: true, type: 'internal_llm', model_id: null, temperature: 0.3, schema_json: {}, prompt_template: '', timeout_ms: 120000 },
  pending_chunk: { enabled: true, type: 'builtin', chunk_mode: 'heading', max_length: 1000, overlap_length: 100, keep_heading: true, merge_small_chunks: false },
  pending_embedding: { enabled: true, embedding_model_id: null, batch_size: 20, skip_empty_chunks: true, retry_times: 3, timeout_ms: 120000 },
  pending_relocate: { enabled: true, target_strategy: 'current_collection', tag_strategy: 'none', metadata_writeback: false, auto_publish: false },
}

const form = reactive<DocPipelineConfig>(JSON.parse(JSON.stringify(defaultForm)))

const mcpServers = ref<{ id: string; name: string; is_enabled: boolean }[]>([])
const models = ref<{ id: string; model_name: string }[]>([])

let initialForm = ''

function schemaJson(obj: Record<string, unknown>) {
  try { return JSON.stringify(obj, null, 2) } catch { return '{}' }
}

function onSchemaInput(val: string, stage: 'pending_ocr' | 'ocr_processing' | 'ocr_finalize') {
  try {
    form[stage].judge.output_schema = JSON.parse(val)
    delete schemaError.value[stage]
  } catch {
    schemaError.value[stage] = 'JSON 格式错误，已保留原值'
  }
}

async function loadConfig() {
  loading.value = true
  try {
    const config = await docPipelineApi.getConfig()
    Object.assign(form, JSON.parse(JSON.stringify(config)))
    initialForm = JSON.stringify(form)
  } catch {
    ElMessage.error('加载配置失败')
  } finally {
    loading.value = false
  }
}

async function loadMcpServers() {
  try {
    const res = await docPipelineApi.getMcpServers()
    mcpServers.value = res.servers || []
  } catch { /* ignore */ }
}

async function loadModels() {
  try {
    models.value = await docPipelineApi.getModels()
  } catch { /* ignore */ }
}

function onOpen() {
  schemaError.value = {}
  loadConfig()
  loadMcpServers()
  loadModels()
}

async function save() {
  if (Object.keys(schemaError.value).length > 0) {
    ElMessage.warning('请先修正所有阶段中格式错误的输出 Schema')
    return
  }
  saving.value = true
  try {
    const result = await docPipelineApi.saveConfig(JSON.parse(JSON.stringify(form)))
    Object.assign(form, result)
    initialForm = JSON.stringify(form)
    ElMessage.success('配置已保存')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

async function resetStage() {
  try {
    await ElMessageBox.confirm(`确定恢复「${stages.find(s => s.key === activeStage.value)?.label}」阶段为默认配置吗？`, '恢复默认', { type: 'warning' })
    await docPipelineApi.resetConfig([activeStage.value])
    await loadConfig()
    ElMessage.success('已恢复默认')
  } catch { /* cancelled */ }
}

function onClose() {
  if (JSON.stringify(form) !== initialForm) {
    ElMessage.warning('未保存的配置已丢弃')
  }
}
</script>

<style scoped>
.pipeline-config {
  display: flex;
  gap: 0;
  height: 520px;
}
.pipeline-nav {
  width: 170px;
  border-right: 1px solid #ebeef5;
  overflow-y: auto;
  flex-shrink: 0;
}
.nav-item {
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
  transition: background 0.15s;
}
.nav-item:hover { background: #f5f7fa; }
.nav-item.active { background: #ecf5ff; border-right: 3px solid #409eff; }
.nav-label { display: block; font-size: 14px; font-weight: 500; }
.nav-key { display: block; font-size: 11px; color: #999; margin-top: 2px; }
.pipeline-form {
  flex: 1;
  overflow-y: auto;
  padding: 12px 24px;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.schema-error {
  color: #f56c6c;
  font-size: 12px;
  line-height: 1.4;
  margin-top: 4px;
}
</style>
