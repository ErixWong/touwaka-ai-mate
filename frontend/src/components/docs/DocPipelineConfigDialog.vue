<template>
  <el-dialog
    v-model="visible"
    :title="tp('dialogTitle')"
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
            <el-form-item :label="tp('executionMode')"><el-tag size="small" type="info">{{ tp('mcpFixed') }}</el-tag></el-form-item>
            <el-divider content-position="left">{{ tp('mcpConfig') }}</el-divider>
            <el-form-item :label="tp('mcpServer')">
              <el-select v-model="form.pending_ocr.mcp.server" :placeholder="tp('selectMcpServer')" clearable filterable>
                <el-option v-for="s in mcpServers" :key="s.id" :label="s.name" :value="s.name" />
              </el-select>
            </el-form-item>
            <el-form-item :label="tp('submitToolName')">
              <!-- 工具下拉未启用 clearable：OCR 流水线工具为关键配置项，误清空后缺少有效提醒手段，与 McpTargetConfig 参考实现保持一致 -->
              <el-select
                v-model="form.pending_ocr.mcp.tool"
                :placeholder="tp('selectTool')"
                filterable
                :loading="toolCache[form.pending_ocr.mcp.server]?.loading"
                :disabled="!form.pending_ocr.mcp.server"
              >
                <el-option
                  v-if="form.pending_ocr.mcp.tool && isToolValueStale(form.pending_ocr.mcp.server, form.pending_ocr.mcp.tool)"
                  :label="tp('historicalValueMissing', { value: form.pending_ocr.mcp.tool })"
                  :value="form.pending_ocr.mcp.tool"
                  disabled
                />
                <el-option
                  v-for="t in getToolOptions(form.pending_ocr.mcp.server)"
                  :key="t.value"
                  :label="t.label"
                  :value="t.value"
                />
              </el-select>
              <div v-if="form.pending_ocr.mcp.tool && !isToolValueStale(form.pending_ocr.mcp.server, form.pending_ocr.mcp.tool) && getToolDescription(form.pending_ocr.mcp.server, form.pending_ocr.mcp.tool)" class="tool-hint tool-desc">
                 {{ tp('descriptionPrefix') }}{{ getToolDescription(form.pending_ocr.mcp.server, form.pending_ocr.mcp.tool) }}
              </div>
              <div v-if="form.pending_ocr.mcp.server && toolCache[form.pending_ocr.mcp.server]?.loaded && getToolOptions(form.pending_ocr.mcp.server).length === 0 && !isToolValueStale(form.pending_ocr.mcp.server, form.pending_ocr.mcp.tool)" class="tool-hint">
                 {{ tp('toolCacheEmpty') }}
              </div>
              <div v-if="form.pending_ocr.mcp.tool && isToolValueStale(form.pending_ocr.mcp.server, form.pending_ocr.mcp.tool)" class="tool-hint tool-stale">
                 {{ tp('toolValueStale') }}
              </div>
              <div v-if="form.pending_ocr.mcp.server && toolCache[form.pending_ocr.mcp.server]?.error" class="tool-hint tool-error">
                 {{ tp('toolListLoadFailed') }}
              </div>
            </el-form-item>
            <el-form-item :label="tp('providerName')">
              <el-input v-model="form.pending_ocr.provider_name" placeholder="mineru" />
            </el-form-item>
            <!-- 阶段字段优先，系统设置兜底：pending_ocr 使用 MCP 内部超时 -->
            <el-divider content-position="left">{{ tp('attachmentParams') }}</el-divider>
            <el-form-item label="file_base64">
              <div class="param-row">
                <el-tag size="small" type="info">{{ tp('attachmentBase64') }}</el-tag>
                <span class="param-arrow">→</span>
                <el-input v-model="form.pending_ocr.mcp.params_mapping.file_base64" placeholder="file_base64" class="param-mapping-input" />
              </div>
            </el-form-item>
            <el-form-item label="file_name">
              <div class="param-row">
                <el-tag size="small" type="info">{{ tp('attachmentFileName') }}</el-tag>
                <span class="param-arrow">→</span>
                <el-input v-model="form.pending_ocr.mcp.params_mapping.file_name" placeholder="file_name" class="param-mapping-input" />
              </div>
            </el-form-item>
            <el-divider content-position="left">{{ tp('settingParams') }}</el-divider>
            <el-form-item :label="tp('formulaRecognition')">
              <div class="param-row">
                <el-switch v-model="getParamSource('formula_enable').value" />
                <span class="param-arrow">→</span>
                <el-input v-model="form.pending_ocr.mcp.params_mapping.formula_enable" placeholder="formula_enable" class="param-mapping-input" />
              </div>
            </el-form-item>
            <el-form-item :label="tp('tableRecognition')">
              <div class="param-row">
                <el-switch v-model="getParamSource('table_enable').value" />
                <span class="param-arrow">→</span>
                <el-input v-model="form.pending_ocr.mcp.params_mapping.table_enable" placeholder="table_enable" class="param-mapping-input" />
              </div>
            </el-form-item>
            <el-form-item :label="tp('imageAnalysis')">
              <div class="param-row">
                <el-switch v-model="getParamSource('image_analysis').value" />
                <span class="param-arrow">→</span>
                <el-input v-model="form.pending_ocr.mcp.params_mapping.image_analysis" placeholder="image_analysis" class="param-mapping-input" />
              </div>
            </el-form-item>
            <el-form-item :label="tp('language')">
              <div class="param-row lang-param-row">
                <el-switch v-model="getParamSource('lang').enabled" />
                <el-input
                  v-if="getParamSource('lang').enabled"
                  v-model="getParamSource('lang').value"
                  :placeholder="tp('languagePlaceholder')"
                  class="lang-value-input"
                />
                <span class="param-arrow">→</span>
                <el-input v-model="form.pending_ocr.mcp.params_mapping.lang" placeholder="lang" class="param-mapping-input" />
              </div>
              <div v-if="!getParamSource('lang').enabled" class="param-hint">{{ tp('langDisabledHint') }}</div>
            </el-form-item>
            <el-divider content-position="left">{{ tp('llmNormalization') }}</el-divider>
            <el-form-item :label="tp('normalizedModel')">
              <el-select v-model="form.pending_ocr.judge.model_id" :placeholder="tp('defaultModel')" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item :label="tp('temperature')">
              <el-input-number v-model="form.pending_ocr.judge.temperature" :min="0" :max="2" :step="0.1" />
            </el-form-item>
            <el-form-item :label="tp('normalizationPrompt')">
              <el-input v-model="form.pending_ocr.judge.prompt_template" type="textarea" :rows="4" />
            </el-form-item>
            <el-form-item :label="tp('outputSchema')">
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
            <el-form-item :label="tp('executionMode')"><el-tag size="small" type="info">{{ tp('mcpFixed') }}</el-tag></el-form-item>
            <el-divider content-position="left">{{ tp('mcpConfig') }}</el-divider>
            <el-form-item :label="tp('mcpServer')">
              <el-select v-model="form.ocr_processing.mcp.server" :placeholder="tp('selectMcpServer')" clearable filterable>
                <el-option v-for="s in mcpServers" :key="s.id" :label="s.name" :value="s.name" />
              </el-select>
            </el-form-item>
            <el-form-item :label="tp('queryToolName')">
              <el-select
                v-model="form.ocr_processing.mcp.tool"
                :placeholder="tp('selectTool')"
                filterable
                :loading="toolCache[form.ocr_processing.mcp.server]?.loading"
                :disabled="!form.ocr_processing.mcp.server"
              >
                <el-option
                  v-if="form.ocr_processing.mcp.tool && isToolValueStale(form.ocr_processing.mcp.server, form.ocr_processing.mcp.tool)"
                  :label="tp('historicalValueMissing', { value: form.ocr_processing.mcp.tool })"
                  :value="form.ocr_processing.mcp.tool"
                  disabled
                />
                <el-option
                  v-for="t in getToolOptions(form.ocr_processing.mcp.server)"
                  :key="t.value"
                  :label="t.label"
                  :value="t.value"
                />
              </el-select>
              <div v-if="form.ocr_processing.mcp.tool && !isToolValueStale(form.ocr_processing.mcp.server, form.ocr_processing.mcp.tool) && getToolDescription(form.ocr_processing.mcp.server, form.ocr_processing.mcp.tool)" class="tool-hint tool-desc">
                 {{ tp('descriptionPrefix') }}{{ getToolDescription(form.ocr_processing.mcp.server, form.ocr_processing.mcp.tool) }}
              </div>
              <div v-if="form.ocr_processing.mcp.server && toolCache[form.ocr_processing.mcp.server]?.loaded && getToolOptions(form.ocr_processing.mcp.server).length === 0 && !isToolValueStale(form.ocr_processing.mcp.server, form.ocr_processing.mcp.tool)" class="tool-hint">
                 {{ tp('toolCacheEmpty') }}
              </div>
              <div v-if="form.ocr_processing.mcp.tool && isToolValueStale(form.ocr_processing.mcp.server, form.ocr_processing.mcp.tool)" class="tool-hint tool-stale">
                 {{ tp('toolValueStale') }}
              </div>
              <div v-if="form.ocr_processing.mcp.server && toolCache[form.ocr_processing.mcp.server]?.error" class="tool-hint tool-error">
                 {{ tp('toolListLoadFailed') }}
              </div>
            </el-form-item>
            <el-form-item :label="tp('pollIntervalMs')">
              <el-input-number v-model="form.ocr_processing.poll_interval_ms" :min="1000" :step="1000" />
            </el-form-item>
            <!-- 阶段字段优先，系统设置兜底：轮询间隔使用 poll_interval_ms，系统 fast_timeout 作为兜底 -->
            <el-divider content-position="left">{{ tp('llmNormalization') }}</el-divider>
            <el-form-item :label="tp('normalizedModel')">
              <el-select v-model="form.ocr_processing.judge.model_id" :placeholder="tp('defaultModel')" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item :label="tp('temperature')">
              <el-input-number v-model="form.ocr_processing.judge.temperature" :min="0" :max="2" :step="0.1" />
            </el-form-item>
            <el-form-item :label="tp('normalizationPrompt')">
              <el-input v-model="form.ocr_processing.judge.prompt_template" type="textarea" :rows="4" />
            </el-form-item>
            <el-form-item :label="tp('outputSchema')">
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
            <el-divider content-position="left">{{ tp('mcpConfig') }}</el-divider>
            <el-form-item :label="tp('mcpServer')">
              <el-select v-model="form.ocr_finalize.mcp.server" :placeholder="tp('selectMcpServer')" clearable filterable>
                <el-option v-for="s in mcpServers" :key="s.id" :label="s.name" :value="s.name" />
              </el-select>
            </el-form-item>
            <el-divider content-position="left">{{ tp('deliverableTools') }}</el-divider>
            <el-form-item :label="tp('defaultPrimaryDeliverableTool')">
              <el-select
                v-model="form.ocr_finalize.default_deliverable_tool"
                :placeholder="tp('selectTool')"
                filterable
                :loading="toolCache[form.ocr_finalize.mcp.server]?.loading"
                :disabled="!form.ocr_finalize.mcp.server"
              >
                <el-option
                  v-if="form.ocr_finalize.default_deliverable_tool && isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.default_deliverable_tool)"
                  :label="tp('historicalValueMissing', { value: form.ocr_finalize.default_deliverable_tool })"
                  :value="form.ocr_finalize.default_deliverable_tool"
                  disabled
                />
                <el-option
                  v-for="t in getToolOptions(form.ocr_finalize.mcp.server)"
                  :key="t.value"
                  :label="t.label"
                  :value="t.value"
                />
              </el-select>
              <div v-if="form.ocr_finalize.default_deliverable_tool && !isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.default_deliverable_tool) && getToolDescription(form.ocr_finalize.mcp.server, form.ocr_finalize.default_deliverable_tool)" class="tool-hint tool-desc">
                 {{ tp('descriptionPrefix') }}{{ getToolDescription(form.ocr_finalize.mcp.server, form.ocr_finalize.default_deliverable_tool) }}
              </div>
              <div v-if="form.ocr_finalize.mcp.server && toolCache[form.ocr_finalize.mcp.server]?.loaded && getToolOptions(form.ocr_finalize.mcp.server).length === 0 && !isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.default_deliverable_tool)" class="tool-hint">
                 {{ tp('toolCacheEmpty') }}
              </div>
              <div v-if="form.ocr_finalize.default_deliverable_tool && isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.default_deliverable_tool)" class="tool-hint tool-stale">
                 {{ tp('toolValueStale') }}
              </div>
              <div v-if="form.ocr_finalize.mcp.server && toolCache[form.ocr_finalize.mcp.server]?.error" class="tool-hint tool-error">
                 {{ tp('toolListLoadFailed') }}
              </div>
            </el-form-item>
            <el-form-item :label="tp('deliverableListTool')">
              <el-select
                v-model="form.ocr_finalize.list_deliverables_tool"
                :placeholder="tp('selectTool')"
                filterable
                :loading="toolCache[form.ocr_finalize.mcp.server]?.loading"
                :disabled="!form.ocr_finalize.mcp.server"
              >
                <el-option
                  v-if="form.ocr_finalize.list_deliverables_tool && isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.list_deliverables_tool)"
                  :label="tp('historicalValueMissing', { value: form.ocr_finalize.list_deliverables_tool })"
                  :value="form.ocr_finalize.list_deliverables_tool"
                  disabled
                />
                <el-option
                  v-for="t in getToolOptions(form.ocr_finalize.mcp.server)"
                  :key="t.value"
                  :label="t.label"
                  :value="t.value"
                />
              </el-select>
              <div v-if="form.ocr_finalize.list_deliverables_tool && !isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.list_deliverables_tool) && getToolDescription(form.ocr_finalize.mcp.server, form.ocr_finalize.list_deliverables_tool)" class="tool-hint tool-desc">
                 {{ tp('descriptionPrefix') }}{{ getToolDescription(form.ocr_finalize.mcp.server, form.ocr_finalize.list_deliverables_tool) }}
              </div>
              <div v-if="form.ocr_finalize.mcp.server && toolCache[form.ocr_finalize.mcp.server]?.loaded && getToolOptions(form.ocr_finalize.mcp.server).length === 0 && !isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.list_deliverables_tool)" class="tool-hint">
                 {{ tp('toolCacheEmpty') }}
              </div>
              <div v-if="form.ocr_finalize.list_deliverables_tool && isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.list_deliverables_tool)" class="tool-hint tool-stale">
                 {{ tp('toolValueStale') }}
              </div>
              <div v-if="form.ocr_finalize.mcp.server && toolCache[form.ocr_finalize.mcp.server]?.error" class="tool-hint tool-error">
                 {{ tp('toolListLoadFailed') }}
              </div>
            </el-form-item>
            <el-form-item :label="tp('imageDeliverableTool')">
              <el-select
                v-model="form.ocr_finalize.image_deliverables_tool"
                :placeholder="tp('selectTool')"
                filterable
                :loading="toolCache[form.ocr_finalize.mcp.server]?.loading"
                :disabled="!form.ocr_finalize.mcp.server"
              >
                <el-option
                  v-if="form.ocr_finalize.image_deliverables_tool && isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.image_deliverables_tool)"
                  :label="tp('historicalValueMissing', { value: form.ocr_finalize.image_deliverables_tool })"
                  :value="form.ocr_finalize.image_deliverables_tool"
                  disabled
                />
                <el-option
                  v-for="t in getToolOptions(form.ocr_finalize.mcp.server)"
                  :key="t.value"
                  :label="t.label"
                  :value="t.value"
                />
              </el-select>
              <div v-if="form.ocr_finalize.image_deliverables_tool && !isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.image_deliverables_tool) && getToolDescription(form.ocr_finalize.mcp.server, form.ocr_finalize.image_deliverables_tool)" class="tool-hint tool-desc">
                 {{ tp('descriptionPrefix') }}{{ getToolDescription(form.ocr_finalize.mcp.server, form.ocr_finalize.image_deliverables_tool) }}
              </div>
              <div v-if="form.ocr_finalize.mcp.server && toolCache[form.ocr_finalize.mcp.server]?.loaded && getToolOptions(form.ocr_finalize.mcp.server).length === 0 && !isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.image_deliverables_tool)" class="tool-hint">
                 {{ tp('toolCacheEmpty') }}
              </div>
              <div v-if="form.ocr_finalize.image_deliverables_tool && isToolValueStale(form.ocr_finalize.mcp.server, form.ocr_finalize.image_deliverables_tool)" class="tool-hint tool-stale">
                 {{ tp('toolValueStale') }}
              </div>
              <div v-if="form.ocr_finalize.mcp.server && toolCache[form.ocr_finalize.mcp.server]?.error" class="tool-hint tool-error">
                 {{ tp('toolListLoadFailed') }}
              </div>
            </el-form-item>
            <el-form-item :label="tp('persistRawResult')">
              <el-switch v-model="form.ocr_finalize.persist_raw_result" />
            </el-form-item>
            <el-form-item :label="tp('persistImageAttachments')">
              <el-switch v-model="form.ocr_finalize.persist_image_attachments" />
            </el-form-item>
            <el-divider content-position="left">{{ tp('llmNormalization') }}</el-divider>
            <el-form-item :label="tp('normalizedModel')">
              <el-select v-model="form.ocr_finalize.judge.model_id" :placeholder="tp('defaultModel')" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item :label="tp('temperature')">
              <el-input-number v-model="form.ocr_finalize.judge.temperature" :min="0" :max="2" :step="0.1" />
            </el-form-item>
            <el-form-item :label="tp('normalizationPrompt')">
              <el-input v-model="form.ocr_finalize.judge.prompt_template" type="textarea" :rows="4" />
            </el-form-item>
            <el-form-item :label="tp('outputSchema')">
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
            <el-form-item :label="tp('enabled')"><el-switch v-model="form.pending_clean.enabled" /></el-form-item>
            <el-form-item :label="tp('executionMode')">
              <el-select v-model="form.pending_clean.type">
                <el-option :label="tp('internalLlm')" value="internal_llm" />
                <el-option :label="tp('script')" value="script" />
                <el-option :label="tp('disabled')" value="disabled" />
              </el-select>
            </el-form-item>
            <el-form-item :label="tp('model')">
              <el-select v-model="form.pending_clean.model_id" :placeholder="tp('defaultModel')" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item :label="tp('temperature')">
              <el-input-number v-model="form.pending_clean.temperature" :min="0" :max="2" :step="0.1" />
            </el-form-item>
            <el-form-item :label="tp('chunkMaxLength')">
              <el-input-number v-model="form.pending_clean.chunk_max_length" :min="500" :step="500" />
            </el-form-item>
            <el-form-item :label="tp('timeoutMs')">
              <el-input-number v-model="form.pending_clean.llm_timeout_ms" :min="60000" :step="30000" />
              <div class="param-hint">{{ tp('taskTimeoutFallback') }}</div>
            </el-form-item>
            <el-form-item :label="tp('cleanPrompt')">
              <el-input v-model="form.pending_clean.prompt_template" type="textarea" :rows="4" />
            </el-form-item>
            <el-divider content-position="left">{{ tp('cleaningRules') }}</el-divider>
            <el-form-item :label="tp('removePageNumber')"><el-switch v-model="form.pending_clean.rules.remove_page_number" /></el-form-item>
            <el-form-item :label="tp('removeWatermark')"><el-switch v-model="form.pending_clean.rules.remove_watermark" /></el-form-item>
            <el-form-item :label="tp('removeGarbledText')"><el-switch v-model="form.pending_clean.rules.remove_garbled_text" /></el-form-item>
            <el-form-item :label="tp('removeHeaderFooter')"><el-switch v-model="form.pending_clean.rules.remove_header_footer" /></el-form-item>
          </template>

          <!-- pending_outline -->
          <template v-if="activeStage === 'pending_outline'">
            <el-form-item :label="tp('model')">
              <el-select v-model="form.pending_outline.model_id" :placeholder="tp('defaultModel')" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item :label="tp('temperature')">
              <el-input-number v-model="form.pending_outline.temperature" :min="0" :max="2" :step="0.1" />
            </el-form-item>
            <el-form-item :label="tp('timeoutMs')">
              <el-input-number v-model="form.pending_outline.llm_timeout_ms" :min="60000" :step="30000" />
              <div class="param-hint">{{ tp('taskTimeoutFallback') }}</div>
            </el-form-item>
            <el-form-item :label="tp('windowSize')">
              <el-input-number v-model="form.pending_outline.window_size" :min="1000" :step="1000" />
            </el-form-item>
            <el-form-item :label="tp('stepSize')">
              <el-input-number v-model="form.pending_outline.step_size" :min="1000" :step="1000" />
            </el-form-item>
            <el-form-item :label="tp('maxHeadingLevel')">
              <el-input-number v-model="form.pending_outline.max_heading_level" :min="1" :max="10" :step="1" />
            </el-form-item>
            <el-form-item :label="tp('deduplicateTitles')"><el-switch v-model="form.pending_outline.deduplicate_titles" /></el-form-item>
            <!-- 章节提取参数说明面板 -->
            <el-alert
              :title="tp('outlineParamGuideTitle')"
              type="info"
              :closable="false"
              show-icon
              style="margin-top: 12px;"
            >
              <template #default>
                <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 12px; line-height: 1.6;">
                   <li><strong>{{ tp('windowSize') }}</strong>{{ tp('outlineGuideWindow') }}</li>
                   <li><strong>{{ tp('stepSize') }}</strong>{{ tp('outlineGuideStep') }}</li>
                   <li><strong>{{ tp('maxHeadingLevel') }}</strong>{{ tp('outlineGuideHeading') }}</li>
                   <li><strong>{{ tp('recommended') }}</strong>{{ tp('outlineGuideRecommended') }}</li>
                </ul>
              </template>
            </el-alert>
          </template>

          <!-- pending_chunk -->
          <template v-if="activeStage === 'pending_chunk'">
            <el-form-item :label="tp('enabled')"><el-switch v-model="form.pending_chunk.enabled" /></el-form-item>
            <el-form-item :label="tp('chunkMode')">
              <el-select v-model="form.pending_chunk.chunk_mode">
                <el-option :label="tp('chunkModeHeading')" value="heading" />
                <el-option :label="tp('chunkModeParagraph')" value="paragraph" />
                <el-option :label="tp('chunkModeFixed')" value="fixed" />
                <el-option :label="tp('chunkModeMixed')" value="mixed" />
              </el-select>
            </el-form-item>
            <el-form-item :label="tp('maxLength')">
              <el-input-number v-model="form.pending_chunk.max_length" :min="100" :step="100" />
            </el-form-item>
            <el-form-item :label="tp('overlapLength')">
              <el-input-number v-model="form.pending_chunk.overlap_length" :min="0" :step="50" />
            </el-form-item>
            <el-form-item :label="tp('keepHeading')"><el-switch v-model="form.pending_chunk.keep_heading" /></el-form-item>
            <el-form-item :label="tp('mergeSmallChunks')"><el-switch v-model="form.pending_chunk.merge_small_chunks" /></el-form-item>
          </template>

          <!-- pending_embedding -->
          <template v-if="activeStage === 'pending_embedding'">
            <el-form-item :label="tp('enabled')"><el-switch v-model="form.pending_embedding.enabled" /></el-form-item>
            <el-form-item :label="tp('embeddingModel')">
              <el-select v-model="form.pending_embedding.embedding_model_id" :placeholder="tp('defaultModel')" clearable filterable>
                <el-option v-for="m in models" :key="m.id" :label="m.model_name" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item :label="tp('batchSize')">
              <el-input-number v-model="form.pending_embedding.batch_size" :min="1" :step="5" />
            </el-form-item>
            <el-form-item :label="tp('skipEmptyChunks')"><el-switch v-model="form.pending_embedding.skip_empty_chunks" /></el-form-item>
            <el-form-item :label="tp('retryTimes')">
              <el-input-number v-model="form.pending_embedding.retry_times" :min="0" :max="10" :step="1" />
            </el-form-item>
            <el-form-item :label="tp('timeoutMs')">
              <el-input-number v-model="form.pending_embedding.embedding_timeout_ms" :min="10000" :step="10000" />
              <div class="param-hint">{{ tp('fastTimeoutFallback') }}</div>
            </el-form-item>
          </template>

        </el-form>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="resetStage">{{ tp('resetDefault') }}</el-button>
        <el-button @click="visible = false">{{ tp('cancel') }}</el-button>
        <el-button type="primary" :loading="saving" :disabled="!loadedFromBackend" @click="save">{{ tp('save') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { docPipelineApi, type DocPipelineConfig } from '@/api/doc-pipeline'
import { mcpApi, type McpToolCache } from '@/api/services'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
}>()
const { t } = useI18n()

const visible = ref(props.modelValue)
watch(() => props.modelValue, (v) => { visible.value = v })
watch(visible, (v) => { emit('update:modelValue', v) })

const stages = [
  { key: 'pending_ocr', label: 'OCR提交' },
  { key: 'ocr_processing', label: 'OCR轮询' },
  { key: 'ocr_finalize', label: 'OCR产物提取' },
  { key: 'pending_clean', label: '文本清洗' },
  { key: 'pending_outline', label: '章节提取' },
  { key: 'pending_chunk', label: '文本分块' },
  { key: 'pending_embedding', label: '向量化' },
]

const activeStage = ref('pending_ocr')
const saving = ref(false)
const loading = ref(false)
const loadedFromBackend = ref(false)  // 配置是否成功从后端加载
const schemaError = ref<Record<string, string>>({})

const defaultForm: DocPipelineConfig = {
  meta: { version: 1, enabled: true },
  pending_ocr: {
    enabled: true, type: 'mcp', provider_name: 'mineru',
    mcp: {
      server: 'mineru',
      tool: 'create_task_from_file',
      params_mapping: { file_base64: 'file_base64', file_name: 'file_name', formula_enable: 'formula_enable', table_enable: 'table_enable', image_analysis: 'image_analysis', lang: 'lang' },
      param_sources: {
        file_base64: { group: 'attachment', field: 'file_base64' },
        file_name: { group: 'attachment', field: 'file_name' },
        formula_enable: { group: 'setting', value: true },
        table_enable: { group: 'setting', value: true },
        image_analysis: { group: 'setting', value: true },
        lang: { group: 'setting', value: null, enabled: false },
      },
    },
    judge: { model_id: null, temperature: 0.1, prompt_template: '', output_schema: {} },
  },
  ocr_processing: {
    enabled: true, type: 'mcp', poll_interval_ms: 5000,
    mcp: { server: 'mineru', tool: 'get_task_status', params_mapping: { task_id: 'task_id' }, params: {} },
    judge: { model_id: null, temperature: 0.1, prompt_template: '', output_schema: {} },
  },
  ocr_finalize: {
    enabled: true, mcp: { server: 'mineru' },
    default_deliverable_tool: 'get_default_deliverable', list_deliverables_tool: 'list_deliverables', image_deliverables_tool: 'get_image_deliverables',
    // 阶段字段优先：使用 MCP 内部超时
    download_deliverable_tool: null, persist_raw_result: true, persist_image_attachments: true,
    judge: { model_id: null, temperature: 0.1, prompt_template: '', output_schema: {} },
  },
  pending_clean: {
    enabled: true, type: 'internal_llm', model_id: null, temperature: 0.3, chunk_max_length: 8000, llm_timeout_ms: 300000,
    prompt_template: '',
    rules: { remove_page_number: true, remove_watermark: true, remove_garbled_text: true, remove_header_footer: true },
  },
  pending_outline: {
    enabled: true,
    type: 'internal_llm',
    strategy: 'llm',
    model_id: null,
    temperature: 0.3,
    window_size: 60000,
    step_size: 40000,
    max_heading_level: 3,
    preserve_line_info: true,
    deduplicate_titles: true,
    llm_timeout_ms: 300000,
  },
  pending_chunk: { enabled: true, type: 'builtin', chunk_mode: 'heading', max_length: 1000, overlap_length: 100, keep_heading: true, merge_small_chunks: false },
  pending_embedding: {
    enabled: true, embedding_model_id: null, batch_size: 20, skip_empty_chunks: true, retry_times: 3, embedding_timeout_ms: 120000,
  },
}

const form = reactive<DocPipelineConfig>(JSON.parse(JSON.stringify(defaultForm)))

function resetFormToDefaults() {
  Object.assign(form, JSON.parse(JSON.stringify(defaultForm)))
}

const mcpServers = ref<{ id: string; name: string; is_enabled: boolean }[]>([])
const models = ref<{ id: string; model_name: string }[]>([])

interface ToolCacheEntry {
  tools: McpToolCache[]
  loading: boolean
  loaded: boolean
  error: boolean
}
const toolCache = ref<Record<string, ToolCacheEntry>>({})

function tp(key: string, params?: Record<string, unknown>) {
  return t(`docs.workspace.pipeline.${key}`, params)
}

function getToolOptions(serverName: string): { label: string; value: string; description?: string }[] {
  const entry = toolCache.value[serverName]
  if (!entry || !entry.tools.length) return []
  return entry.tools.map(t => ({
    label: t.tool_name,
    value: t.tool_name,
    description: t.description,
  }))
}

function getToolDescription(serverName: string, toolValue: string): string | null {
  if (!serverName || !toolValue) return null
  const entry = toolCache.value[serverName]
  if (!entry || !entry.tools) return null
  const tool = entry.tools.find(t => t.tool_name === toolValue)
  return tool?.description || null
}

function isToolValueStale(serverName: string, toolValue: string): boolean {
  if (!toolValue || !serverName) return false
  const entry = toolCache.value[serverName]
  if (!entry || !entry.loaded || entry.error) return false
  return !entry.tools.some(t => t.tool_name === toolValue)
}

async function loadToolsForServer(serverName: string) {
  if (!serverName || !mcpServers.value.length) return
  if (toolCache.value[serverName]?.loaded) return

  if (!toolCache.value[serverName]) {
    toolCache.value[serverName] = { tools: [], loading: false, loaded: false, error: false }
  }
  toolCache.value[serverName].loading = true
  toolCache.value[serverName].error = false

  try {
    const server = mcpServers.value.find(s => s.name === serverName)
    if (!server) {
      toolCache.value[serverName].tools = []
      toolCache.value[serverName].loaded = true
      return
    }
    const res = await mcpApi.getServerTools(server.id)
    toolCache.value[serverName].tools = res.tools || []
    toolCache.value[serverName].loaded = true
    toolCache.value[serverName].error = false
  } catch {
    toolCache.value[serverName].error = true
  } finally {
    toolCache.value[serverName].loading = false
  }
}

async function loadToolsForConfiguredServers() {
  const servers = new Set<string>()
  if (form.pending_ocr.mcp?.server) servers.add(form.pending_ocr.mcp.server)
  if (form.ocr_processing.mcp?.server) servers.add(form.ocr_processing.mcp.server)
  if (form.ocr_finalize.mcp?.server) servers.add(form.ocr_finalize.mcp.server)
  await Promise.all([...servers].map(s => loadToolsForServer(s)))
}

let initialForm = ''

function schemaJson(obj: Record<string, unknown>) {
  try { return JSON.stringify(obj, null, 2) } catch { return '{}' }
}

function onSchemaInput(val: string, stage: 'pending_ocr' | 'ocr_processing' | 'ocr_finalize') {
  try {
    form[stage].judge.output_schema = JSON.parse(val)
    delete schemaError.value[stage]
  } catch {
    schemaError.value[stage] = tp('schemaInvalid')
  }
}

function ensureParamSources() {
  if (!form.pending_ocr.mcp.param_sources) {
    form.pending_ocr.mcp.param_sources = {
      file_base64: { group: 'attachment', field: 'file_base64' },
      file_name: { group: 'attachment', field: 'file_name' },
      formula_enable: { group: 'setting', value: true },
      table_enable: { group: 'setting', value: true },
      image_analysis: { group: 'setting', value: true },
      lang: { group: 'setting', value: null, enabled: false },
    }
  }
}

function getParamSource(key: string): { group: string; value: boolean | string | null; enabled?: boolean } {
  ensureParamSources()
  const sources = form.pending_ocr.mcp.param_sources!
  if (!sources[key]) {
    if (key === 'file_base64' || key === 'file_name') {
      sources[key] = { group: 'attachment', field: key }
    } else if (key === 'lang') {
      sources[key] = { group: 'setting', value: null, enabled: false }
    } else {
      sources[key] = { group: 'setting', value: true }
    }
  }
  return sources[key] as { group: string; value: boolean | string | null; enabled?: boolean }
}


async function loadMcpServers() {
  try {
    const res = await docPipelineApi.getMcpServers()
    mcpServers.value = res.servers || []
  } catch (err) {
    console.error('Failed to load MCP servers:', err)
    ElMessage.error(tp('loadMcpServersFailed'))
    mcpServers.value = []
  }
}

async function loadModels() {
  try {
    const res = await docPipelineApi.getModels()
    models.value = res || []
  } catch (err) {
    console.error('Failed to load models:', err)
    ElMessage.error(tp('loadModelsFailed'))
    models.value = []
  }
}

async function onOpen() {
  schemaError.value = {}
  toolCache.value = {}
  await loadConfig()
  await loadMcpServers()
  await loadModels()
  if (mcpServers.value.length > 0) {
    await loadToolsForConfiguredServers()
  }
}

async function loadConfig() {
  loading.value = true
  loadedFromBackend.value = false
  try {
    const config = await docPipelineApi.getConfig()
    Object.assign(form, JSON.parse(JSON.stringify(config)))
    loadedFromBackend.value = true
    initialForm = JSON.stringify(form)
  } catch {
    resetFormToDefaults()
    initialForm = JSON.stringify(form)
    ElMessage.error(tp('loadConfigFailed'))
    loadedFromBackend.value = false
  } finally {
    loading.value = false
  }
}

watch(() => form.pending_ocr.mcp?.server, (s) => { if (s) loadToolsForServer(s) })
watch(() => form.ocr_processing.mcp?.server, (s) => { if (s) loadToolsForServer(s) })
watch(() => form.ocr_finalize.mcp?.server, (s) => { if (s) loadToolsForServer(s) })

async function save() {
  // 禁止在配置未成功加载时保存占位结构
  if (!loadedFromBackend.value) {
    ElMessage.warning(tp('configNotLoadedRetry'))
    return
  }

  if (Object.keys(schemaError.value).length > 0) {
    ElMessage.warning(tp('schemaFixRequired'))
    return
  }

  const staleFields: string[] = []
  const ps = form.pending_ocr.mcp?.server
  const pt = form.pending_ocr.mcp?.tool
  if (ps && pt && isToolValueStale(ps, pt)) staleFields.push(tp('staleFieldPendingOcrTool'))

  const os = form.ocr_processing.mcp?.server
  const ot = form.ocr_processing.mcp?.tool
  if (os && ot && isToolValueStale(os, ot)) staleFields.push(tp('staleFieldOcrProcessingTool'))

  const fs = form.ocr_finalize.mcp?.server
  if (fs) {
    if (form.ocr_finalize.default_deliverable_tool && isToolValueStale(fs, form.ocr_finalize.default_deliverable_tool)) staleFields.push(tp('staleFieldDefaultPrimaryDeliverableTool'))
    if (form.ocr_finalize.list_deliverables_tool && isToolValueStale(fs, form.ocr_finalize.list_deliverables_tool)) staleFields.push(tp('staleFieldDeliverableListTool'))
    if (form.ocr_finalize.image_deliverables_tool && isToolValueStale(fs, form.ocr_finalize.image_deliverables_tool)) staleFields.push(tp('staleFieldImageDeliverableTool'))
  }

  if (staleFields.length > 0) {
    ElMessage.warning(tp('staleToolsWarning', { fields: staleFields.join('、') }))
    return
  }

  saving.value = true
  try {
    const result = await docPipelineApi.saveConfig(JSON.parse(JSON.stringify(form)))
    Object.assign(form, result)
    initialForm = JSON.stringify(form)
    ElMessage.success(tp('saveSuccess'))
  } catch {
    ElMessage.error(tp('saveFailed'))
  } finally {
    saving.value = false
  }
}

async function resetStage() {
  if (!loadedFromBackend.value) {
    ElMessage.warning(tp('resetDisabledWhenNotLoaded'))
    return
  }

  try {
    await ElMessageBox.confirm(tp('resetConfirmMessage', { stage: stages.find(s => s.key === activeStage.value)?.label }), tp('resetDefault'), { type: 'warning' })
    await docPipelineApi.resetConfig([activeStage.value])
    await loadConfig()
    ElMessage.success(tp('resetSuccess'))
  } catch { /* cancelled */ }
}

function onClose() {
  if (JSON.stringify(form) !== initialForm) {
    ElMessage.warning(tp('unsavedDiscarded'))
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
.tool-hint {
  color: #909399;
  font-size: 12px;
  line-height: 1.4;
  margin-top: 4px;
}
.tool-hint.tool-desc {
  color: #606266;
}
.tool-hint.tool-stale {
  color: #e6a23c;
}
.tool-hint.tool-error {
  color: #f56c6c;
}
.param-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.param-arrow {
  color: #909399;
  font-size: 14px;
}
.param-mapping-input {
  width: 180px;
}
.lang-param-row {
  flex-wrap: wrap;
}
.lang-value-input {
  width: 120px;
}
.param-hint {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
}
</style>
