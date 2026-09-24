/**
 * Notes governance 测试（Phase 3 阶段三重写，issue #1132 决策 3 修订）
 *
 * 断言清单：
 *  1. 仅暴露四个 erix 原生 note_*（minimal + enable_notes）
 *  2. 旧名（notes_* / notes.take 等）全不暴露、不可执行
 *  3. full 策略 / enable_notes=false 时不暴露（门控保留）
 *  4. 门控一致性：定义可见但执行 context 不带门控标志时被拒
 *  5. forget 后存储无 record（物理删除）且结果归一化 {status:"deleted"}
 *  6. note_read 不滑动续期（expires_at 不增加）
 *  7. relevance 越界返回 invalid，不静默 clamp
 *  8. note_take 超过 4000 字符拒绝
 *  9. 子 agent 只见授权范围内的原生名；psyche_config 关闭 notes 时不可见
 * 10. note_forget description 不含"墓碑"表述
 */

import { expect } from 'chai';
import ToolManager from '../../lib/tool-manager.js';
import { isNotesEnabled } from '../../lib/psyche/notes-config.js';
import { getExpertChildScopedTools } from '../../lib/agent/expert-child-scoped-tools.js';
import {
  DbNoteRecordStore,
  buildNotesScopeRef,
} from '../../lib/notes/index.js';
import { createFakeDb } from './helpers/fake-db.js';

const NATIVE_NOTE_NAMES = ['note_take', 'note_read', 'note_list', 'note_forget'];

function toolNames(tools) {
  return tools.map(tool => tool.function?.name).filter(Boolean);
}

function makeManager() {
  const db = createFakeDb();
  const store = new DbNoteRecordStore({ db });
  const manager = new ToolManager(
    { getModel: () => null },
    'expert_1',
    { noteRecordStore: store },
  );
  return { manager, db, store };
}

const MINIMAL_CONTEXT = { userId: 'user_1', expertId: 'expert_1', context_strategy: 'minimal', enable_notes: true };

describe('notes governance', () => {
  it('reads enable_notes from object and JSON psyche_config values', () => {
    expect(isNotesEnabled({
      expert: { psyche_config: { enable_notes: false } },
    })).to.equal(false);
    expect(isNotesEnabled({
      expert: { psyche_config: JSON.stringify({ enable_notes: false }) },
    })).to.equal(false);
    expect(isNotesEnabled({
      expert: { psyche_config: { enable_notes: true } },
    })).to.equal(true);
  });

  it('1. exposes exactly the four native erix note_* tools only when minimal + enabled', async () => {
    const { manager } = makeManager();
    const minimalNames = toolNames(await manager.getToolDefinitions({
      context_strategy: 'minimal',
      enable_notes: true,
    }));
    const noteNames = minimalNames.filter(name => /note/.test(name)).sort();
    expect(noteNames).to.deep.equal([...NATIVE_NOTE_NAMES].sort());
  });

  it('2. does not expose or execute legacy notes_* names or dotted aliases', async () => {
    const { manager, store } = makeManager();
    const names = toolNames(await manager.getToolDefinitions({
      context_strategy: 'minimal',
      enable_notes: true,
    }));
    for (const legacy of ['notes_take', 'notes_read', 'notes_list', 'notes_forget', 'notes.take', 'notes.read', 'notes.list']) {
      expect(names).not.to.include(legacy);
    }

    const result = await manager.executeTool('notes_take', { key: 'k', content: 'c' }, MINIMAL_CONTEXT);
    expect(result.success).to.equal(false);
    expect(result.error).to.include('Tool not found');

    // 旧名执行不会写入任何记录
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');
    expect(await store.read(scopeRef, 'k')).to.equal(undefined);
  });

  it('3. hides note tools for full strategy and when enable_notes is false', async () => {
    const { manager } = makeManager();
    const fullNames = toolNames(await manager.getToolDefinitions({ context_strategy: 'full', enable_notes: true }));
    expect(fullNames.filter(name => /note/.test(name))).to.deep.equal([]);

    const disabledNames = toolNames(await manager.getToolDefinitions({ context_strategy: 'minimal', enable_notes: false }));
    expect(disabledNames.filter(name => /note/.test(name))).to.deep.equal([]);
  });

  it('4. keeps execution gating aligned with visible tool definitions', async () => {
    const { manager } = makeManager();
    const definitions = await manager.getToolDefinitions({ context_strategy: 'minimal', enable_notes: true });
    expect(toolNames(definitions)).to.include('note_take');

    const blocked = await manager.executeTool(
      'note_take',
      { key: 'execution-gate', content: 'blocked without flags' },
      { user_id: 'user_1', expert_id: 'expert_1' },
    );
    expect(blocked.success).to.equal(false);
    expect(blocked.error).to.include('minimal context strategy');

    const disabled = await manager.executeTool(
      'note_take',
      { key: 'execution-gate', content: 'blocked when disabled' },
      { ...MINIMAL_CONTEXT, enable_notes: false },
    );
    expect(disabled.success).to.equal(false);

    const allowed = await manager.executeTool(
      'note_take',
      { key: 'execution-gate', content: 'allowed with flags' },
      MINIMAL_CONTEXT,
    );
    expect(allowed.success).to.equal(true);
  });

  it('5. note_forget physically deletes the record and normalizes status to deleted', async () => {
    const { manager, db, store } = makeManager();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');

    const saved = await manager.executeTool('note_take', { key: 'k1', content: 'to be forgotten' }, MINIMAL_CONTEXT);
    expect(saved.success).to.equal(true);
    expect(await store.read(scopeRef, 'k1')).to.not.equal(undefined);

    const forgotten = await manager.executeTool('note_forget', { key: 'k1' }, MINIMAL_CONTEXT);
    expect(forgotten.success).to.equal(true);
    expect(forgotten.data.status).to.equal('deleted');

    // forget 后存储无 record（物理删除）
    expect(await store.read(scopeRef, 'k1')).to.equal(undefined);
    expect(db.rows.size).to.equal(0);

    const after = await manager.executeTool('note_read', { key: 'k1' }, MINIMAL_CONTEXT);
    expect(after.data.status).to.equal('missing');
  });

  it('6. note_read does not touch or renew TTL', async () => {
    const { manager, db, store } = makeManager();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');

    await manager.executeTool('note_take', { key: 'k1', content: 'ttl check' }, MINIMAL_CONTEXT);
    const before = db.rows.get(`${scopeRef}|k1`).expires_at;
    expect(before).to.be.a('number').greaterThan(Date.now());

    await new Promise(resolve => setTimeout(resolve, 5));
    const read = await manager.executeTool('note_read', { key: 'k1' }, MINIMAL_CONTEXT);
    expect(read.success).to.equal(true);
    expect(read.data.value).to.equal('ttl check');

    const after = db.rows.get(`${scopeRef}|k1`).expires_at;
    // 不滑动续期：expires_at 只减不增（read 不 touch）
    expect(after).to.equal(before);
  });

  it('7. rejects out-of-range relevance instead of silently clamping', async () => {
    const { manager, store } = makeManager();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');

    const tooHigh = await manager.executeTool('note_take', { key: 'rel', content: 'c', relevance: 5 }, MINIMAL_CONTEXT);
    expect(tooHigh.success).to.equal(false);
    expect(tooHigh.error).to.include('relevance');

    const tooLow = await manager.executeTool('note_take', { key: 'rel', content: 'c', relevance: -1 }, MINIMAL_CONTEXT);
    expect(tooLow.success).to.equal(false);

    // 非法 relevance 不写入任何记录
    expect(await store.read(scopeRef, 'rel')).to.equal(undefined);

    const valid = await manager.executeTool('note_take', { key: 'rel', content: 'c', relevance: 0.8 }, MINIMAL_CONTEXT);
    expect(valid.success).to.equal(true);
  });

  it('8. rejects note_take content over 4000 characters', async () => {
    const { manager, store } = makeManager();
    const scopeRef = buildNotesScopeRef('user_1', 'expert_1');

    const oversized = await manager.executeTool('note_take', { key: 'big', content: 'x'.repeat(4001) }, MINIMAL_CONTEXT);
    expect(oversized.success).to.equal(false);
    expect(oversized.error).to.include('4000');
    expect(await store.read(scopeRef, 'big')).to.equal(undefined);
  });

  it('9. child agents only see authorized native names; disabled notes hide them', async () => {
    const { manager } = makeManager();
    const tools = await getExpertChildScopedTools({
      expert_service: {
        toolManager: manager,
        expertConfig: {
          expert: {
            context_strategy: 'minimal',
            psyche_config: { enable_notes: true },
          },
        },
      },
      invocation_context: {
        principal_user_id: 'user_1',
        callee_agent_id: 'expert_1',
      },
      effective_scope: {
        tools: ['note_take', 'note_read', 'notes_take'],
      },
    });

    // 子 agent 只见授权范围内的原生名：notes_take 已退役，被过滤
    expect(toolNames(tools).sort()).to.deep.equal(['note_read', 'note_take']);

    const hidden = await getExpertChildScopedTools({
      expert_service: {
        toolManager: manager,
        expertConfig: {
          expert: {
            context_strategy: 'minimal',
            psyche_config: { enable_notes: false },
          },
        },
      },
      invocation_context: {
        principal_user_id: 'user_1',
        callee_agent_id: 'expert_1',
      },
      effective_scope: {
        tools: ['note_take', 'note_read'],
      },
    });
    expect(hidden).to.deep.equal([]);
  });

  it('10. note_forget description has no tombstone wording and note tools match erix schemas', async () => {
    const { manager } = makeManager();
    const definitions = await manager.getToolDefinitions({ context_strategy: 'minimal', enable_notes: true });
    const byName = new Map(definitions.map(def => [def.function.name, def]));

    for (const name of NATIVE_NOTE_NAMES) {
      expect(byName.has(name), name).to.equal(true);
      expect(byName.get(name).function.parameters.type).to.equal('object');
    }
    expect(byName.get('note_take').function.parameters.required).to.deep.equal(['key']);

    const forgetDescription = byName.get('note_forget').function.description;
    expect(forgetDescription).not.to.include('墓碑');
    expect(forgetDescription).to.include('物理删除');
  });
});
