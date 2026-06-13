/**
 * OCR 参数来源拆分测试
 * 验证 pending_ocr 阶段的 param_sources 配置正确工作
 */

import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  DOC_PIPELINE_DEFAULTS,
  getStageDefault,
  mergeWithDefaults,
  normalizeParamSources,
} from '../../lib/doc-pipeline-defaults.js'

describe('OCR Parameter Sources', () => {
  describe('Default Configuration', () => {
    it('should have param_sources in pending_ocr default', () => {
      const defaultConfig = getStageDefault('pending_ocr')
      expect(defaultConfig.mcp).to.have.property('param_sources')
      expect(defaultConfig.mcp.param_sources).to.be.an('object')
    })

    it('should have attachment group for file_base64 and file_name', () => {
      const defaultConfig = getStageDefault('pending_ocr')
      expect(defaultConfig.mcp.param_sources.file_base64.group).to.equal('attachment')
      expect(defaultConfig.mcp.param_sources.file_name.group).to.equal('attachment')
    })

    it('should have setting group for boolean params with true default', () => {
      const defaultConfig = getStageDefault('pending_ocr')
      expect(defaultConfig.mcp.param_sources.formula_enable.group).to.equal('setting')
      expect(defaultConfig.mcp.param_sources.formula_enable.value).to.equal(true)
      expect(defaultConfig.mcp.param_sources.table_enable.group).to.equal('setting')
      expect(defaultConfig.mcp.param_sources.table_enable.value).to.equal(true)
      expect(defaultConfig.mcp.param_sources.image_analysis.group).to.equal('setting')
      expect(defaultConfig.mcp.param_sources.image_analysis.value).to.equal(true)
    })

    it('should have lang disabled by default', () => {
      const defaultConfig = getStageDefault('pending_ocr')
      expect(defaultConfig.mcp.param_sources.lang.group).to.equal('setting')
      expect(defaultConfig.mcp.param_sources.lang.enabled).to.equal(false)
      expect(defaultConfig.mcp.param_sources.lang.value).to.equal(null)
    })

    it('should not have params with hardcoded lang', () => {
      const defaultConfig = getStageDefault('pending_ocr')
      expect(defaultConfig.mcp.params).to.be.undefined
    })
  })

  describe('normalizeParamSources', () => {
    it('should normalize old config with params to param_sources', () => {
      const oldConfig = {
        enabled: true,
        type: 'mcp',
        mcp: {
          server: 'mineru',
          tool: 'create_task_from_file',
          params_mapping: {
            file_base64: 'file_base64',
            file_name: 'file_name',
            lang: 'lang',
            formula_enable: 'formula_enable',
            table_enable: 'table_enable',
            image_analysis: 'image_analysis',
          },
          params: {
            lang: 'ch',
            formula_enable: true,
            table_enable: true,
            image_analysis: true,
          },
        },
      }

      const normalized = normalizeParamSources(oldConfig, 'pending_ocr')
      expect(normalized.mcp).to.have.property('param_sources')
      expect(normalized.mcp).to.not.have.property('params')
      expect(normalized.mcp.param_sources.lang.enabled).to.equal(true)
      expect(normalized.mcp.param_sources.lang.value).to.equal('ch')
    })

    it('should handle old config without params', () => {
      const oldConfig = {
        enabled: true,
        type: 'mcp',
        mcp: {
          server: 'mineru',
          tool: 'create_task_from_file',
          params_mapping: {
            file_base64: 'file_base64',
            file_name: 'file_name',
          },
        },
      }

      const normalized = normalizeParamSources(oldConfig, 'pending_ocr')
      expect(normalized.mcp).to.have.property('param_sources')
      expect(normalized.mcp.param_sources.formula_enable.value).to.equal(true)
      expect(normalized.mcp.param_sources.lang.enabled).to.equal(false)
    })

    it('should not modify other stages', () => {
      const otherConfig = {
        enabled: true,
        type: 'mcp',
        mcp: {
          server: 'mineru',
          tool: 'get_task_status',
        },
      }

      const normalized = normalizeParamSources(otherConfig, 'ocr_processing')
      expect(normalized).to.deep.equal(otherConfig)
    })
  })

  describe('mergeWithDefaults', () => {
    it('should merge old stored config and normalize param_sources', () => {
      const stored = {
        pending_ocr: {
          enabled: true,
          type: 'mcp',
          mcp: {
            server: 'mineru',
            tool: 'create_task_from_file',
            params_mapping: {
              file_base64: 'file_base64',
              file_name: 'file_name',
              lang: 'lang',
            },
            params: {
              lang: 'en',
              formula_enable: false,
            },
          },
        },
      }

      const merged = mergeWithDefaults(stored)
      expect(merged.pending_ocr.mcp).to.have.property('param_sources')
      expect(merged.pending_ocr.mcp.param_sources.lang.value).to.equal('en')
      expect(merged.pending_ocr.mcp.param_sources.lang.enabled).to.equal(true)
      expect(merged.pending_ocr.mcp.param_sources.formula_enable.value).to.equal(false)
    })

    it('should fill missing stages with defaults', () => {
      const stored = {}
      const merged = mergeWithDefaults(stored)
      expect(merged.pending_ocr.mcp).to.have.property('param_sources')
      expect(merged.pending_ocr.mcp.param_sources.lang.enabled).to.equal(false)
    })
  })

  describe('MCP Payload Building', () => {
    it('should not include lang when disabled', async () => {
      const { default: DocumentOcrService } = await import('../../lib/document-ocr-service.js')
      const service = new DocumentOcrService(null, {
        callMcp: async () => ({ content: '{}' }),
        callLlm: null,
        getDocPipelineConfig: async () => getStageDefault('pending_ocr'),
      })

      const config = getStageDefault('pending_ocr')
      const attachmentContext = {
        file_base64: 'test-base64',
        file_name: 'test.pdf',
      }

      const params = service._buildMcpParams(config, {}, attachmentContext)
      expect(params).to.have.property('file_base64')
      expect(params).to.have.property('file_name')
      expect(params).to.have.property('formula_enable')
      expect(params.formula_enable).to.equal(true)
      expect(params).to.not.have.property('lang')
    })

    it('should include lang when enabled', async () => {
      const { default: DocumentOcrService } = await import('../../lib/document-ocr-service.js')
      const service = new DocumentOcrService(null, {
        callMcp: async () => ({ content: '{}' }),
        callLlm: null,
        getDocPipelineConfig: async () => getStageDefault('pending_ocr'),
      })

      const config = getStageDefault('pending_ocr')
      config.mcp.param_sources.lang.enabled = true
      config.mcp.param_sources.lang.value = 'en'

      const attachmentContext = {
        file_base64: 'test-base64',
        file_name: 'test.pdf',
      }

      const params = service._buildMcpParams(config, {}, attachmentContext)
      expect(params).to.have.property('lang')
      expect(params.lang).to.equal('en')
    })

    it('should respect false values for boolean params', async () => {
      const { default: DocumentOcrService } = await import('../../lib/document-ocr-service.js')
      const service = new DocumentOcrService(null, {
        callMcp: async () => ({ content: '{}' }),
        callLlm: null,
        getDocPipelineConfig: async () => getStageDefault('pending_ocr'),
      })

      const config = getStageDefault('pending_ocr')
      config.mcp.param_sources.formula_enable.value = false
      config.mcp.param_sources.table_enable.value = false
      config.mcp.param_sources.image_analysis.value = false

      const attachmentContext = {
        file_base64: 'test-base64',
        file_name: 'test.pdf',
      }

      const params = service._buildMcpParams(config, {}, attachmentContext)
      expect(params.formula_enable).to.equal(false)
      expect(params.table_enable).to.equal(false)
      expect(params.image_analysis).to.equal(false)
    })

    it('should allow runtime overrides', async () => {
      const { default: DocumentOcrService } = await import('../../lib/document-ocr-service.js')
      const service = new DocumentOcrService(null, {
        callMcp: async () => ({ content: '{}' }),
        callLlm: null,
        getDocPipelineConfig: async () => getStageDefault('pending_ocr'),
      })

      const config = getStageDefault('pending_ocr')
      const attachmentContext = {
        file_base64: 'test-base64',
        file_name: 'test.pdf',
      }

      const runtimeOverrides = {
        formula_enable: false,
        lang: 'jp',
      }

      const params = service._buildMcpParams(config, runtimeOverrides, attachmentContext)
      expect(params.formula_enable).to.equal(false)
      expect(params.lang).to.equal('jp')
    })

    it('should use custom MCP param mapping', async () => {
      const { default: DocumentOcrService } = await import('../../lib/document-ocr-service.js')
      const service = new DocumentOcrService(null, {
        callMcp: async () => ({ content: '{}' }),
        callLlm: null,
        getDocPipelineConfig: async () => getStageDefault('pending_ocr'),
      })

      const config = getStageDefault('pending_ocr')
      config.mcp.params_mapping.file_base64 = 'file_content'
      config.mcp.params_mapping.formula_enable = 'enable_formula'

      const attachmentContext = {
        file_base64: 'test-base64',
        file_name: 'test.pdf',
      }

      const params = service._buildMcpParams(config, {}, attachmentContext)
      expect(params).to.have.property('file_content')
      expect(params).to.not.have.property('file_base64')
      expect(params).to.have.property('enable_formula')
      expect(params).to.not.have.property('formula_enable')
    })
  })

  describe('Old Config Compatibility - Payload Behavior', () => {
    it('should include boolean params in payload after migrating incomplete params_mapping', async () => {
      const { default: DocumentOcrService } = await import('../../lib/document-ocr-service.js')

      const oldConfig = {
        enabled: true,
        type: 'mcp',
        mcp: {
          server: 'mineru',
          tool: 'create_task_from_file',
          params_mapping: {
            file_base64: 'file_base64',
            file_name: 'file_name',
            lang: 'lang',
          },
          params: {
            formula_enable: false,
          },
        },
      }

      const normalized = normalizeParamSources(oldConfig, 'pending_ocr')

      const service = new DocumentOcrService(null, {
        callMcp: async () => ({ content: '{}' }),
        callLlm: null,
        getDocPipelineConfig: async () => normalized,
      })

      const attachmentContext = {
        file_base64: 'test-base64',
        file_name: 'test.pdf',
      }

      const params = service._buildMcpParams(normalized, {}, attachmentContext)

      expect(params).to.have.property('file_base64')
      expect(params).to.have.property('file_name')
      expect(params).to.have.property('formula_enable')
      expect(params.formula_enable).to.equal(false)
      expect(params).to.have.property('table_enable')
      expect(params.table_enable).to.equal(true)
      expect(params).to.have.property('image_analysis')
      expect(params.image_analysis).to.equal(true)
      expect(params).to.not.have.property('lang')
    })

    it('should merge missing params_mapping keys with defaults', () => {
      const oldConfig = {
        enabled: true,
        type: 'mcp',
        mcp: {
          server: 'mineru',
          tool: 'create_task_from_file',
          params_mapping: {
            file_base64: 'file_base64',
            file_name: 'file_name',
          },
          params: {
            formula_enable: true,
            table_enable: false,
          },
        },
      }

      const normalized = normalizeParamSources(oldConfig, 'pending_ocr')

      expect(normalized.mcp.params_mapping).to.have.property('formula_enable')
      expect(normalized.mcp.params_mapping).to.have.property('table_enable')
      expect(normalized.mcp.params_mapping).to.have.property('image_analysis')
      expect(normalized.mcp.params_mapping).to.have.property('lang')
    })

    it('should preserve existing custom params_mapping during migration', () => {
      const oldConfig = {
        enabled: true,
        type: 'mcp',
        mcp: {
          server: 'mineru',
          tool: 'create_task_from_file',
          params_mapping: {
            file_base64: 'file_content',
            file_name: 'filename',
            formula_enable: 'enable_formula',
          },
          params: {
            formula_enable: true,
          },
        },
      }

      const normalized = normalizeParamSources(oldConfig, 'pending_ocr')

      expect(normalized.mcp.params_mapping.file_base64).to.equal('file_content')
      expect(normalized.mcp.params_mapping.file_name).to.equal('filename')
      expect(normalized.mcp.params_mapping.formula_enable).to.equal('enable_formula')
      expect(normalized.mcp.params_mapping.table_enable).to.equal('table_enable')
      expect(normalized.mcp.params_mapping.image_analysis).to.equal('image_analysis')
    })
  })
})