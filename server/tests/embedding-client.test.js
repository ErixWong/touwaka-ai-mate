/**
 * EmbeddingClient 测试
 *
 * 验证 EmbeddingClient 的各种构造方式和基础调用路径。
 */

import { describe, it } from 'mocha'
import { expect } from 'chai'
import EmbeddingClient from '../../lib/embedding-client.js'

describe('EmbeddingClient', () => {
  describe('constructor', () => {
    it('should create client from modelConfig', () => {
      const client = new EmbeddingClient({
        base_url: 'https://api.example.com/v1',
        api_key: 'sk-test',
        model_name: 'text-embedding-3-small',
      })
      expect(client).to.be.instanceOf(EmbeddingClient)
      expect(client.baseUrl).to.equal('https://api.example.com/v1')
      expect(client.modelName).to.equal('text-embedding-3-small')
    })

    it('should throw when base_url is missing', () => {
      expect(() => new EmbeddingClient({})).to.throw('requires a model config with base_url')
    })

    it('should normalize base_url via normalizeBaseUrl', () => {
      const client = new EmbeddingClient({
        base_url: 'api.example.com/v1/',
        api_key: 'sk-test',
      })
      expect(client.baseUrl).to.equal('https://api.example.com/v1')
    })

    it('should default model_name when not provided', () => {
      const client = new EmbeddingClient({
        base_url: 'https://api.example.com',
        api_key: 'sk-test',
      })
      expect(client.modelName).to.equal('text-embedding-3-small')
    })

    it('should handle localhost without protocol', () => {
      const client = new EmbeddingClient({
        base_url: 'localhost:11434/v1',
        api_key: '',
      })
      expect(client.baseUrl).to.equal('http://localhost:11434/v1')
    })
  })

  describe('embed()', () => {
    it('should return null for empty text', async () => {
      const client = new EmbeddingClient({
        base_url: 'https://api.example.com',
        api_key: 'sk-test',
      })
      const result = await client.embed('')
      expect(result).to.be.null
    })

    it('should return null for non-string input', async () => {
      const client = new EmbeddingClient({
        base_url: 'https://api.example.com',
        api_key: 'sk-test',
      })
      const result = await client.embed(null)
      expect(result).to.be.null
    })
  })

  describe('fromEnv()', () => {
    it('should return null when env vars not set', () => {
      delete process.env.EMBEDDING_API_URL
      delete process.env.EMBEDDING_API_KEY
      const client = EmbeddingClient.fromEnv()
      expect(client).to.be.null
    })
  })

  describe('fromModelId()', () => {
    it('should return null when modelId is null', async () => {
      const client = await EmbeddingClient.fromModelId({}, null)
      expect(client).to.be.null
    })

    it('should return null when model config not found', async () => {
      const mockDb = {
        async getModelConfig(id) { return null; },
      }
      const client = await EmbeddingClient.fromModelId(mockDb, 'nonexistent')
      expect(client).to.be.null
    })
  })
})
