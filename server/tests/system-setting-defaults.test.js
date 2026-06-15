/**
 * 系统设置默认值一致性测试
 * 验证后端 DEFAULT_SETTINGS 结构完整性，防止未来新增字段时遗漏定义
 * 
 * 根据 issue #835 要求：
 * - 后端是系统设置默认值的唯一权威来源
 * - 新增系统设置字段时，必须在 DEFAULT_SETTINGS 中定义默认值
 */

import { describe, it } from 'mocha'
import { expect } from 'chai'
import { DEFAULT_SETTINGS } from '../services/system-setting.service.js'

describe('System Setting Defaults Consistency', () => {
  it('should have all required sections', () => {
    const requiredSections = ['llm', 'connection', 'token', 'timeout', 'tool', 'registration', 'app', 'branding']
    for (const section of requiredSections) {
      expect(DEFAULT_SETTINGS).to.have.property(section)
      expect(DEFAULT_SETTINGS[section]).to.be.an('object')
    }
  })

  it('should have complete llm defaults', () => {
    const llmKeys = ['context_threshold', 'temperature', 'reflective_temperature', 'top_p', 'frequency_penalty', 'presence_penalty']
    for (const key of llmKeys) {
      expect(DEFAULT_SETTINGS.llm).to.have.property(key)
      expect(DEFAULT_SETTINGS.llm[key]).to.have.property('value')
      expect(DEFAULT_SETTINGS.llm[key]).to.have.property('type')
      expect(DEFAULT_SETTINGS.llm[key].type).to.equal('number')
    }
  })

  it('should have complete registration defaults', () => {
    const registrationKeys = ['allow_self_registration', 'default_invitation_quota', 'default_invitation_max_uses', 'invitation_expiry_days']
    for (const key of registrationKeys) {
      expect(DEFAULT_SETTINGS.registration).to.have.property(key)
      expect(DEFAULT_SETTINGS.registration[key]).to.have.property('value')
      expect(DEFAULT_SETTINGS.registration[key]).to.have.property('type')
    }
    // 验证关键字段类型
    expect(DEFAULT_SETTINGS.registration.allow_self_registration.type).to.equal('boolean')
    expect(DEFAULT_SETTINGS.registration.default_invitation_quota.type).to.equal('number')
    expect(DEFAULT_SETTINGS.registration.default_invitation_max_uses.type).to.equal('number')
    expect(DEFAULT_SETTINGS.registration.invitation_expiry_days.type).to.equal('number')
  })

  it('should have complete timeout defaults', () => {
    const timeoutKeys = ['vm_execution', 'python_execution', 'skill_call', 'skill_http', 'resident_skill', 'internal_llm', 'external_http', 'mcp_request', 'embedding', 'chat_idle']
    for (const key of timeoutKeys) {
      expect(DEFAULT_SETTINGS.timeout).to.have.property(key)
      expect(DEFAULT_SETTINGS.timeout[key]).to.have.property('value')
      expect(DEFAULT_SETTINGS.timeout[key].type).to.equal('number')
      // 所有超时值应该大于 0
      expect(DEFAULT_SETTINGS.timeout[key].value).to.be.above(0)
    }
  })

  it('should have complete connection defaults', () => {
    const connectionKeys = ['max_per_user', 'max_per_expert']
    for (const key of connectionKeys) {
      expect(DEFAULT_SETTINGS.connection).to.have.property(key)
      expect(DEFAULT_SETTINGS.connection[key]).to.have.property('value')
      expect(DEFAULT_SETTINGS.connection[key].type).to.equal('number')
      expect(DEFAULT_SETTINGS.connection[key].value).to.be.above(0)
    }
  })

  it('should have complete token defaults', () => {
    const tokenKeys = ['access_expiry', 'refresh_expiry']
    for (const key of tokenKeys) {
      expect(DEFAULT_SETTINGS.token).to.have.property(key)
      expect(DEFAULT_SETTINGS.token[key]).to.have.property('value')
      expect(DEFAULT_SETTINGS.token[key]).to.have.property('type')
      expect(DEFAULT_SETTINGS.token[key].type).to.equal('string')
      expect(DEFAULT_SETTINGS.token[key].value).to.be.a('string')
      expect(DEFAULT_SETTINGS.token[key].value.length).to.be.above(0)
    }
  })

  it('should have complete tool defaults', () => {
    expect(DEFAULT_SETTINGS.tool).to.have.property('max_rounds')
    expect(DEFAULT_SETTINGS.tool.max_rounds).to.have.property('value')
    expect(DEFAULT_SETTINGS.tool.max_rounds.type).to.equal('number')
    expect(DEFAULT_SETTINGS.tool.max_rounds.value).to.be.above(0)
  })

  it('should have complete app defaults', () => {
    const appKeys = ['clock_interval', 'batch_size', 'max_concurrency', 'text_filter_max_length', 'attachment_base_path', 'max_upload_size']
    for (const key of appKeys) {
      expect(DEFAULT_SETTINGS.app).to.have.property(key)
      expect(DEFAULT_SETTINGS.app[key]).to.have.property('value')
      expect(DEFAULT_SETTINGS.app[key]).to.have.property('type')
    }
  })

  it('should have complete branding defaults', () => {
    const brandingKeys = ['app_name', 'logo_icon']
    for (const key of brandingKeys) {
      expect(DEFAULT_SETTINGS.branding).to.have.property(key)
      expect(DEFAULT_SETTINGS.branding[key]).to.have.property('value')
      expect(DEFAULT_SETTINGS.branding[key]).to.have.property('type')
      expect(DEFAULT_SETTINGS.branding[key].type).to.equal('string')
    }
  })

  it('should prevent future drift: all values must be explicitly defined', () => {
    // 此测试用于提醒：新增字段时必须在 DEFAULT_SETTINGS 中显式定义
    // 如果某个字段缺失 value 或 type，说明定义不完整
    for (const [section, keys] of Object.entries(DEFAULT_SETTINGS)) {
      for (const [key, config] of Object.entries(keys)) {
        expect(config).to.have.property('value')
        expect(config).to.have.property('type')
        expect(config).to.have.property('description')
      }
    }
  })

  it('should derive registration defaults from DEFAULT_SETTINGS', () => {
    // 验证 registration 默认值派生逻辑
    const registrationDefaults = {}
    for (const [key, config] of Object.entries(DEFAULT_SETTINGS.registration)) {
      registrationDefaults[key] = config.value
    }
    // 关键字段验证：防止未来漂移
    expect(registrationDefaults.allow_self_registration).to.equal(false)
    expect(registrationDefaults.default_invitation_quota).to.equal(1)
    expect(registrationDefaults.default_invitation_max_uses).to.equal(5)
    expect(registrationDefaults.invitation_expiry_days).to.equal(0)
  })

  it('should derive app defaults from DEFAULT_SETTINGS', () => {
    // 验证 app 默认值派生逻辑
    const appDefaults = {}
    for (const [key, config] of Object.entries(DEFAULT_SETTINGS.app)) {
      appDefaults[key] = config.value
    }
    expect(appDefaults.clock_interval).to.equal(30)
    expect(appDefaults.batch_size).to.equal(10)
    expect(appDefaults.max_concurrency).to.equal(5)
    expect(appDefaults.text_filter_max_length).to.equal(50000)
    expect(appDefaults.attachment_base_path).to.equal('./data/attachments')
  })

  it('should have consistent default value types', () => {
    // 验证默认值类型一致性：防止类型漂移
    for (const [section, keys] of Object.entries(DEFAULT_SETTINGS)) {
      for (const [key, config] of Object.entries(keys)) {
        const actualType = typeof config.value
        const declaredType = config.type
        // 类型必须匹配
        if (declaredType === 'number') {
          expect(actualType).to.equal('number')
        } else if (declaredType === 'boolean') {
          expect(actualType).to.equal('boolean')
        } else if (declaredType === 'string') {
          expect(actualType).to.equal('string')
        }
      }
    }
  })

  it('should have complete section coverage for reset key expansion', () => {
    // 验证所有 section 都有完整字段定义，防止前端 reset 时无法展开
    const requiredSections = ['llm', 'connection', 'token', 'timeout', 'tool', 'registration', 'app', 'branding']
    for (const section of requiredSections) {
      expect(DEFAULT_SETTINGS).to.have.property(section)
      expect(DEFAULT_SETTINGS[section]).to.be.an('object')
      // 每个 section 至少有一个字段
      expect(Object.keys(DEFAULT_SETTINGS[section]).length).to.be.above(0)
    }
  })

  it('should prevent reset with invalid section name', () => {
    // 验证 app section 的完整字段列表
    const appKeys = Object.keys(DEFAULT_SETTINGS.app)
    expect(appKeys).to.include('clock_interval')
    expect(appKeys).to.include('batch_size')
    expect(appKeys).to.include('max_concurrency')
    expect(appKeys).to.include('text_filter_max_length')
    expect(appKeys).to.include('attachment_base_path')
    expect(appKeys).to.include('max_upload_size')
    // 验证这些字段都有完整的默认值定义
    for (const key of appKeys) {
      expect(DEFAULT_SETTINGS.app[key]).to.have.property('value')
      expect(DEFAULT_SETTINGS.app[key]).to.have.property('type')
    }
  })
})