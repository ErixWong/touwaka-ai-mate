/**
 * max_tool_rounds 写入侧硬校验（issue #1166）
 *
 * 覆盖 ExpertController.create / ExpertController.update 两条写入口（两者历史上都
 * 没有服务端范围校验：5000 / -5 / 2.5 能直接落库，把探针候选集与工具轮循环的资源
 * 上界一起放飞）。这里只测校验语义，不连数据库：db / ctx 都是内存假象。
 *
 * 判别点（对应工单验收 ①）：
 *   - `undefined` 不改；`null` 清空并保持「继承系统默认」语义（**不许当 0 或 1**）
 *   - 1–50 的整数正常通过
 *   - 0 / 负数 / 51 / 巨大值 / 小数 / 字符串 / 布尔 / 对象 → ctx.error(…, 400) 拒绝，
 *     且**不静默夹取**（51 不许被改成 50 后落库）、**不落裸 ctx.body**
 *   - 范围常量与既有约定（models 列注释、前端 :min/:max、系统设置 tool.max_rounds）
 *     一致，防止四处各写一套范围
 */

import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import ExpertController from '../controllers/expert.controller.js'
import {
  MAX_TOOL_ROUNDS_MIN,
  MAX_TOOL_ROUNDS_MAX,
} from '../../lib/agent/max-tool-rounds.js'
import { DEFAULT_SETTINGS } from '../services/system-setting.service.js'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

function createFakeDb() {
  const observed = {
    created: [],
    updates: [],
    expert: { id: 'expert_test', name: '老专家', max_tool_rounds: null },
  }
  const expertModel = {
    async findOne({ where }) {
      return where?.id === observed.expert.id ? { ...observed.expert } : null
    },
    async create(data) {
      observed.created.push(data)
      return data
    },
    async update(values, options) {
      observed.updates.push({ where: options?.where, values })
      return [1]
    },
  }
  return {
    observed,
    getModel(name) {
      if (name === 'expert') return expertModel
      if (name === 'system_setting') {
        return {
          async findAll() { return [] },
          async create() { return {} },
        }
      }
      return {}
    },
  }
}

/**
 * 假 ctx：success / error 走统一响应假象；**给 body 装一个 setter**，
 * 这样代码要图省事写裸 `ctx.body = {...}` 就会留痕，被断言抓住。
 */
function createCtx({ body, params } = {}) {
  const calls = { success: [], error: [], rawBody: [] }
  let rawBody
  const ctx = {
    params: params || {},
    request: { body: body === undefined ? {} : body },
    calls,
    success(data, message) { calls.success.push({ data, message }) },
    error(message, status) { calls.error.push({ message, status }) },
  }
  Object.defineProperty(ctx, 'body', {
    get() { return rawBody },
    set(value) { rawBody = value; calls.rawBody.push(value) },
  })
  return ctx
}

const INVALID_VALUES = [
  ['0', 0],
  ['负数 -5', -5],
  ['上界外 51', 51],
  ['巨大值 5000', 5000],
  ['小数 2.5', 2.5],
  ['数字字符串 "10"', '10'],
  ['非数字字符串 "abc"', 'abc'],
  ['空字符串', ''],
  ['布尔 true', true],
  ['对象', { value: 5 }],
  ['NaN', Number.NaN],
]

describe('Expert max_tool_rounds 写入侧硬校验（issue #1166）', () => {
  let db
  let controller

  beforeEach(() => {
    db = createFakeDb()
    controller = new ExpertController(db, null)
    // 创建路径会读系统默认 LLM 参数；与本次校验无关，直接桩掉，避免依赖真实配置
    controller.systemSettingService = {
      async getLLMDefaults() {
        return {
          context_threshold: 0.7,
          temperature: 0.7,
          reflective_temperature: 0.3,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
        }
      },
    }
  })

  const update = (body) => {
    const ctx = createCtx({ body, params: { id: 'expert_test' } })
    return controller.update(ctx).then(() => ({
      ctx,
      updated: db.observed.updates[db.observed.updates.length - 1]?.values,
    }))
  }

  const create = (body) => {
    const ctx = createCtx({ body })
    return controller.create(ctx).then(() => ({
      ctx,
      created: db.observed.created[db.observed.created.length - 1],
    }))
  }

  describe('范围常量与既有约定对齐（防四处漂移）', () => {
    it('后端范围就是 1–50', () => {
      expect(MAX_TOOL_ROUNDS_MIN).to.equal(1)
      expect(MAX_TOOL_ROUNDS_MAX).to.equal(50)
    })

    it('与系统设置 tool.max_rounds 的默认值/校验范围同源', () => {
      expect(DEFAULT_SETTINGS.tool.max_rounds.value).to.be.within(
        MAX_TOOL_ROUNDS_MIN, MAX_TOOL_ROUNDS_MAX)
      // 系统设置的合法范围与专家级字段必须同宽（否则会出现"系统默认反而不合法"）
      const serviceSource = readFileSync(
        `${REPO_ROOT}server/services/system-setting.service.js`, 'utf-8')
      const rule = serviceSource.match(/'tool\.max_rounds':\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+)\s*\}/)
      expect(rule, '系统设置里 tool.max_rounds 的校验规则必须存在').to.not.equal(null)
      expect(Number(rule[1])).to.equal(MAX_TOOL_ROUNDS_MIN)
      expect(Number(rule[2])).to.equal(MAX_TOOL_ROUNDS_MAX)
    })

    it('与生成模型列注释、前端输入框 min/max 一致', () => {
      const modelSource = readFileSync(`${REPO_ROOT}models/expert.js`, 'utf-8')
      expect(modelSource).to.match(/max_tool_rounds[\s\S]{0,200}范围 1-50/)

      const vueSource = readFileSync(
        `${REPO_ROOT}frontend/src/components/settings/ExpertSettingsTab.vue`, 'utf-8')
      expect(vueSource).to.match(
        /v-model="expertForm\.max_tool_rounds"[^>]*:min="1"[^>]*:max="50"/)
    })
  })

  describe('update：PUT /api/experts/:id', () => {
    INVALID_VALUES.forEach(([label, value]) => {
      it(`${label} 被 ctx.error(…, 400) 拒绝，且不落库、不静默夹取`, async () => {
        const { ctx, updated } = await update({ name: '改名', max_tool_rounds: value })

        expect(ctx.calls.error, '必须走 ctx.error').to.have.lengthOf(1)
        expect(ctx.calls.error[0].status).to.equal(400)
        expect(ctx.calls.error[0].message).to.be.a('string').and.not.empty
        expect(ctx.calls.error[0].message).to.include('max_tool_rounds')
        expect(ctx.calls.error[0].message).to.include(
          `${MAX_TOOL_ROUNDS_MIN}-${MAX_TOOL_ROUNDS_MAX}`)
        expect(ctx.calls.success, '拒绝时不能再调 ctx.success').to.have.lengthOf(0)
        expect(ctx.calls.rawBody, '禁止裸 ctx.body 破坏统一响应').to.have.lengthOf(0)
        expect(updated, '校验失败时一个字段都不许写').to.equal(undefined)
      })
    })

    it('51 不许被夹成 50 后偷偷落库（不许静默夹取）', async () => {
      const { ctx, updated } = await update({ max_tool_rounds: MAX_TOOL_ROUNDS_MAX + 1 })
      expect(ctx.calls.error).to.have.lengthOf(1)
      expect(updated, '被拒的字段不能以夹取后的值出现在 updates 里').to.equal(undefined)
    })

    ;[MAX_TOOL_ROUNDS_MIN, 1, 20, 49, MAX_TOOL_ROUNDS_MAX].forEach((value) => {
      it(`${value} 正常通过并原样落库`, async () => {
        const { ctx, updated } = await update({ max_tool_rounds: value })
        expect(ctx.calls.error, JSON.stringify(ctx.calls)).to.have.lengthOf(0)
        expect(ctx.calls.success).to.have.lengthOf(1)
        expect(updated).to.have.property('max_tool_rounds', value)
      })
    })

    it('null 清空并回到「继承系统默认」（既不是 0 也不是 1）', async () => {
      const { ctx, updated } = await update({ max_tool_rounds: null })
      expect(ctx.calls.error, JSON.stringify(ctx.calls)).to.have.lengthOf(0)
      expect(updated).to.have.property('max_tool_rounds', null)
      expect(updated.max_tool_rounds).to.not.equal(0)
      expect(updated.max_tool_rounds).to.not.equal(1)
    })

    it('undefined（不带该字段）完全不改它，其他字段照常更新', async () => {
      const { ctx, updated } = await update({ name: '只改名' })
      expect(ctx.calls.error, JSON.stringify(ctx.calls)).to.have.lengthOf(0)
      expect(updated).to.have.property('name', '只改名')
      expect(updated, '不该出现 max_tool_rounds 键').to.not.have.property('max_tool_rounds')
    })

    it('校验发生在写库之前（非法值不会先更新再报错）', async () => {
      const { ctx } = await update({ max_tool_rounds: -1 })
      expect(db.observed.updates, '一次 UPDATE 都不许发出').to.have.lengthOf(0)
      expect(ctx.calls.error).to.have.lengthOf(1)
    })
  })

  describe('create：POST /api/experts/', () => {
    INVALID_VALUES.forEach(([label, value]) => {
      it(`${label} 被 ctx.error(…, 400) 拒绝，且不落库`, async () => {
        const { ctx, created } = await create({ name: '新专家', max_tool_rounds: value })

        expect(ctx.calls.error, '必须走 ctx.error').to.have.lengthOf(1)
        expect(ctx.calls.error[0].status).to.equal(400)
        expect(ctx.calls.error[0].message).to.include('max_tool_rounds')
        expect(ctx.calls.success).to.have.lengthOf(0)
        expect(ctx.calls.rawBody, '禁止裸 ctx.body 破坏统一响应').to.have.lengthOf(0)
        expect(created, '校验失败时不许创建专家').to.equal(undefined)
      })
    })

    ;[MAX_TOOL_ROUNDS_MIN, 8, MAX_TOOL_ROUNDS_MAX].forEach((value) => {
      it(`${value} 正常通过并原样落库`, async () => {
        const { ctx, created } = await create({ name: '新专家', max_tool_rounds: value })
        expect(ctx.calls.error, JSON.stringify(ctx.calls)).to.have.lengthOf(0)
        expect(created).to.have.property('max_tool_rounds', value)
        // 响应也回显同一值（前端按 response.data.data 消费，字段名不许转换）
        expect(ctx.calls.success[0].data).to.have.property('max_tool_rounds', value)
      })
    })

    it('null 落库为 NULL（= 使用系统默认），不是 0 也不是 1', async () => {
      const { ctx, created } = await create({ name: '新专家', max_tool_rounds: null })
      expect(ctx.calls.error, JSON.stringify(ctx.calls)).to.have.lengthOf(0)
      expect(created).to.have.property('max_tool_rounds', null)
    })

    it('不带该字段时落库为 NULL（保持改造前的"继承系统默认"行为）', async () => {
      const { ctx, created } = await create({ name: '新专家' })
      expect(ctx.calls.error, JSON.stringify(ctx.calls)).to.have.lengthOf(0)
      expect(created).to.have.property('max_tool_rounds', null)
    })

    it('名称校验优先级不变：非法名称仍是第一个错误', async () => {
      const { ctx } = await create({ name: '', max_tool_rounds: 5000 })
      expect(ctx.calls.error).to.have.lengthOf(1)
      expect(ctx.calls.error[0].message).to.include('专家名称')
    })
  })
})
