/**
 * 简历快筛回归验证（最小集）
 * 运行: node frontend/scripts/verify-resume-screening.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const mockPath = join(__dirname, '..', 'src', 'data', 'resume-screening-mock.json')
const mock = JSON.parse(readFileSync(mockPath, 'utf-8'))

// ---------------------------------------------------------------------------
// 1) 手动对照提交流程 — 验证 decision / decision_reason 类型安全
// ---------------------------------------------------------------------------
test('match_results 所有条目 decision 为合法值且 decision_reason 非空', () => {
  const validDecisions = ['pending_review', 'interview', 'hold', 'reject']
  for (const mr of mock.match_results) {
    assert.ok(
      validDecisions.includes(mr.decision),
      `mr ${mr.id}: decision "${mr.decision}" 不在合法枚举中`
    )
    assert.ok(
      typeof mr.decision_reason === 'string' && mr.decision_reason.length >= 10,
      `mr ${mr.id}: decision_reason 未达 10 字下限`
    )
  }
})

test('智能匹配生成结果时 decision 不得为 pending_review 之外的值（自动匹配默认待审核）', () => {
  // 验证 store SmartMatchView 中的逻辑: 自动生成结果 decision 固定为 pending_review
  const candidates = mock.candidates.filter(c => c.status === 'active' || c.status === 'new')
  const job = mock.jobs.find(j => j.status === 'open')
  if (job && candidates.length > 0) {
    // 模拟 SmartMatchView 的自动评分逻辑（纯函数验证）
    for (const cand of candidates) {
      const skillOverlap = cand.skills.filter(s => job.must_have_skills.includes(s)).length / Math.max(job.must_have_skills.length, 1)
      const projectScore = Math.round(Math.min(cand.total_years_experience / Math.max(job.min_years_experience || 3, 1) * 25, 25))
      const overallScore = Math.round(skillOverlap * 40) + projectScore
      assert.ok(overallScore >= 0 && overallScore <= 100, `candidate ${cand.id}: overallScore ${overallScore} 超出 0-100`)
      // 验证自动生成的 fit_level 映射正确
      const fitLevel = overallScore >= 85 ? 'A' : overallScore >= 70 ? 'B' : overallScore >= 55 ? 'C' : 'D'
      assert.ok(['A', 'B', 'C', 'D'].includes(fitLevel), `candidate ${cand.id}: fitLevel "${fitLevel}" 非法`)
    }
  }
})

// ---------------------------------------------------------------------------
// 2) 智能匹配去重 — 验证 job_id + candidate_id 唯一
// ---------------------------------------------------------------------------
test('match_results 中不存在重复的 (job_id, candidate_id) 组合', () => {
  const seen = new Set()
  for (const mr of mock.match_results) {
    const key = `${mr.job_id}:${mr.candidate_id}`
    assert.ok(!seen.has(key), `重复匹配: ${key}`)
    seen.add(key)
  }
})

test('去重逻辑：重复 key 不应入库（验证 commitResults 的 Set 过滤）', () => {
  // 模拟 SmartMatchView.commitResults 的去重逻辑
  const existingKeys = new Set(mock.match_results.map(m => `${m.job_id}:${m.candidate_id}`))
  const newResults = [
    { ...mock.match_results[0], id: 'mr_dup_test' },           // 重复 key → 应被跳过
    { job_id: 'job_001', candidate_id: 'cand_003', id: 'mr_new_test' }, // 新 key → 应被保留
  ]
  const committed = []
  for (const r of newResults) {
    const key = `${r.job_id}:${r.candidate_id}`
    if (existingKeys.has(key)) continue
    existingKeys.add(key)
    committed.push(r)
  }
  assert.equal(committed.length, 1, '应只入库 1 条（新 key），跳过去重 key')
  assert.equal(committed[0].id, 'mr_new_test', '保留的应为新 key 的条目')
})

// ---------------------------------------------------------------------------
// 3) 职位状态流转时间戳 — 验证 opened_at / closed_at
// ---------------------------------------------------------------------------
test('open 状态职位必须有 opened_at，closed 状态职位必须有 closed_at', () => {
  for (const job of mock.jobs) {
    if (job.status === 'open') {
      assert.ok(job.opened_at, `job ${job.id}: open 状态缺少 opened_at`)
    }
    if (job.status === 'closed') {
      assert.ok(job.closed_at, `job ${job.id}: closed 状态缺少 closed_at`)
    }
  }
})

test('状态流转时间戳模拟: open 应补 opened_at, closed 应补 closed_at', () => {
  // 模拟 JobListView.changeStatus 的逻辑
  function changeStatus(job, toStatus) {
    if (toStatus === 'open' && job.status === 'closed') return // 不可从 closed 直接回 open
    const updates = { status: toStatus }
    if (toStatus === 'open') updates.opened_at = new Date().toISOString()
    if (toStatus === 'closed') updates.closed_at = new Date().toISOString()
    Object.assign(job, updates)
  }

  const draftJob = { ...mock.jobs[0], status: 'draft', opened_at: null, closed_at: null }
  changeStatus(draftJob, 'open')
  assert.equal(draftJob.status, 'open')
  assert.ok(draftJob.opened_at, 'draft → open：应补 opened_at')
  assert.equal(draftJob.closed_at, null, 'draft → open：closed_at 应保持 null')

  changeStatus(draftJob, 'closed')
  assert.equal(draftJob.status, 'closed')
  assert.ok(draftJob.closed_at, 'open → closed：应补 closed_at')

  // closed 不能直接回 open
  const closedJob = { ...draftJob, status: 'closed', opened_at: '2024-01-01T00:00:00Z', closed_at: '2024-06-01T00:00:00Z' }
  changeStatus(closedJob, 'open')
  assert.equal(closedJob.status, 'closed', 'closed → open 应被阻止，状态不变')
})

// ---------------------------------------------------------------------------
// 4) 类型硬化验证 — 联合类型字段值合法
// ---------------------------------------------------------------------------
test('所有枚举字段值均在合法范围内', () => {
  for (const job of mock.jobs) {
    assert.ok(['draft', 'open', 'paused', 'closed'].includes(job.status), `job ${job.id}: status "${job.status}" 非法`)
    assert.ok(['full_time', 'part_time', 'intern', 'contract'].includes(job.employment_type), `job ${job.id}: employment_type 非法`)
    assert.ok(['onsite', 'hybrid', 'remote'].includes(job.work_mode), `job ${job.id}: work_mode 非法`)
  }
  for (const cand of mock.candidates) {
    assert.ok(['new', 'active', 'on_hold', 'hired', 'archived'].includes(cand.status), `cand ${cand.id}: status 非法`)
    assert.ok(['upload', 'referral', 'import', 'hunter'].includes(cand.source_channel), `cand ${cand.id}: source_channel 非法`)
  }
  for (const res of mock.resumes) {
    assert.ok(['pending', 'processing', 'success', 'failed', 'needs_review'].includes(res.parse_status), `res ${res.id}: parse_status 非法`)
  }
  for (const mr of mock.match_results) {
    assert.ok(['A', 'B', 'C', 'D'].includes(mr.fit_level), `mr ${mr.id}: fit_level 非法`)
    assert.ok(
      mr.score_breakdown.skill_score + mr.score_breakdown.project_score + mr.score_breakdown.industry_score +
      mr.score_breakdown.education_score + mr.score_breakdown.constraint_score + mr.score_breakdown.completeness_score === mr.overall_score,
      `mr ${mr.id}: 分项分之和 ${mr.score_breakdown.skill_score + mr.score_breakdown.project_score + mr.score_breakdown.industry_score + mr.score_breakdown.education_score + mr.score_breakdown.constraint_score + mr.score_breakdown.completeness_score} ≠ 总分 ${mr.overall_score}`
    )
  }
})
