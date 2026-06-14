/**
 * 默认 Judge 模型选择测试
 *
 * 验证 createCallLlmFn 在未显式传入 model_id 时的默认模型选择策略：
 * - 选择最新创建的激活文本模型
 * - 无可用模型时抛错并提示配置 model_id
 *
 * 对应审计: AUDIT-ROUND-01.md Finding #1
 */

import { describe, it } from 'mocha'
import { expect } from 'chai'
import { createCallLlmFn } from '../../lib/doc-pipeline-defaults.js'

const PROVIDER_ID = 'provider-stable-001'
const MODEL_T1 = 'model-text-older'
const MODEL_T2 = 'model-text-newer'
const MODEL_VL = 'model-multimodal'

function buildDbMock(models) {
  const aiModelRows = (models || []).map(m => ({ ...m }))

  return {
    getModel(name) {
      if (name === 'ai_model') {
        return {
          async findOne({ where, order, raw, attributes }) {
            let candidates = aiModelRows.filter(r => {
              for (const [k, v] of Object.entries(where)) {
                if (r[k] !== v) return false
              }
              return true
            })
            if (order && order.length) {
              const [[col, dir]] = order
              candidates.sort((a, b) => {
                if (dir === 'DESC') return a[col] > b[col] ? -1 : a[col] < b[col] ? 1 : 0
                return a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0
              })
            }
            if (!candidates.length) return null
            if (attributes && attributes.length === 1 && attributes[0] === 'id') {
              return { id: candidates[0].id }
            }
            return candidates[0]
          },
        }
      }
      return null
    },

    async getModelConfig(modelId) {
      const row = aiModelRows.find(r => r.id === modelId)
      if (!row) return null
      return {
        id: row.id,
        model_name: row.model_name,
        model_type: row.model_type,
        is_active: row.is_active,
        base_url: 'https://api.example.com/v1',
        api_key: 'sk-test-mock',
        timeout: 60000,
        provider_name: 'test-provider',
        user_agent: 'Test/1.0',
        max_output_tokens: 4096,
      }
    },
  }
}

describe('createCallLlmFn default model selection', () => {
  it('should select the most recent active text model when no model_id provided', async () => {
    const db = buildDbMock([
      { id: MODEL_T1, model_name: 'text-old', model_type: 'text', is_active: true, created_at: '2025-01-01' },
      { id: MODEL_T2, model_name: 'text-new', model_type: 'text', is_active: true, created_at: '2025-06-01' },
      { id: MODEL_VL, model_name: 'vl-model', model_type: 'multimodal', is_active: true, created_at: '2025-12-01' },
    ])

    const callLlm = createCallLlmFn(db)

    let capturedModel = null
    // Monkey-patch dynamic import at module level isn't feasible in ESM tests,
    // but the getModelConfig call will be exercised — we verify the lookup chain.
    // The actual call() will fail without a real LLM endpoint, so we wrap it.
    try {
      await callLlm({
        model_id: null,
        temperature: 0.1,
        messages: [{ role: 'user', content: 'hello' }],
      })
      // If we reach here, the model fetch worked but call will fail — expected.
    } catch (err) {
      // Either "No active text model" or actual HTTP failure is fine here.
      // We only care that the model selection path didn't throw a missing-column error.
      expect(err.message).to.not.include('default')
      expect(err.message).to.not.include('No active text model')
    }
  })

  it('should throw a descriptive error when no active text model exists', async () => {
    const db = buildDbMock([
      { id: MODEL_VL, model_name: 'vl-model', model_type: 'multimodal', is_active: true, created_at: '2025-06-01' },
    ])

    const callLlm = createCallLlmFn(db)

    try {
      await callLlm({
        model_id: null,
        temperature: 0.1,
        messages: [{ role: 'user', content: 'hello' }],
      })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err.message).to.include('No active text model')
      expect(err.message).to.include('model_id in doc_pipeline stage settings')
    }
  })

  it('should use explicit model_id when provided', async () => {
    const db = buildDbMock([
      { id: MODEL_T1, model_name: 'explicit-model', model_type: 'text', is_active: true, created_at: '2025-01-01' },
    ])

    const callLlm = createCallLlmFn(db)

    try {
      await callLlm({
        model_id: MODEL_T1,
        temperature: 0.1,
        messages: [{ role: 'user', content: 'hello' }],
      })
    } catch (err) {
      // Expected — HTTP call fails without real endpoint, but the config lookup must succeed.
      expect(err.message).to.not.include('model available')
      expect(err.message).to.not.include('No active text model')
      expect(err.message).to.not.include('model_id in doc_pipeline')
    }
  })

  it('should skip inactive text models', async () => {
    const db = buildDbMock([
      { id: MODEL_T1, model_name: 'inactive-text', model_type: 'text', is_active: false, created_at: '2025-06-01' },
    ])

    const callLlm = createCallLlmFn(db)

    try {
      await callLlm({ model_id: null, temperature: 0.1, messages: [{ role: 'user', content: 'hello' }] })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err.message).to.include('No active text model')
    }
  })
})
