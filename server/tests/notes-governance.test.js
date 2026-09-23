import { expect } from 'chai';
import ToolManager from '../../lib/tool-manager.js';
import NotesManager from '../../lib/notes/notes-manager.js';
import { MemoryNotesStore } from '../../lib/psyche-store/memory-store.js';
import { isNotesEnabled } from '../../lib/psyche/notes-config.js';
import { getExpertChildScopedTools } from '../../lib/agent/expert-child-scoped-tools.js';

function toolNames(tools) {
  return tools.map(tool => tool.function?.name).filter(Boolean);
}

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

  it('exposes notes tools only for minimal strategy with notes enabled', async () => {
    const manager = new ToolManager({ getModel: () => null }, 'expert_1');

    const fullNames = toolNames(await manager.getToolDefinitions({
      context_strategy: 'full',
      enable_notes: true,
    }));
    const minimalNames = toolNames(await manager.getToolDefinitions({
      context_strategy: 'minimal',
      enable_notes: true,
    }));
    const disabledNames = toolNames(await manager.getToolDefinitions({
      context_strategy: 'minimal',
      enable_notes: false,
    }));

    expect(fullNames).not.to.include('notes_take');
    expect(minimalNames).to.include('notes_take');
    expect(minimalNames).to.include('notes_read');
    expect(minimalNames).to.include('notes_list');
    expect(minimalNames).to.include('notes_forget');
    expect(minimalNames).to.include('note_take');
    expect(minimalNames).to.include('note_read');
    expect(minimalNames).to.include('note_list');
    expect(minimalNames).to.include('note_forget');
    expect(disabledNames).not.to.include('notes_take');
    expect(disabledNames).not.to.include('note_take');
    expect(fullNames).not.to.include('note_take');
    expect(fullNames).not.to.include('note_forget');
    expect(manager._isNotesTool(['notes', 'take'].join('.'))).to.equal(true);
  });

  it('rejects direct notes execution outside minimal strategy', async () => {
    const manager = new ToolManager({ getModel: () => null }, 'expert_1');
    const result = await manager.executeNotesTool(
      'notes_take',
      { key: 'k', content: 'content' },
      { userId: 'user_1', expertId: 'expert_1', context_strategy: 'full', enable_notes: true },
      'notes_take'
    );

    expect(result.success).to.equal(false);
    expect(result.error).to.include('minimal context strategy');
  });

  it('keeps notes execution gating aligned with visible tool definitions', async () => {
    const manager = new ToolManager({ getModel: () => null }, 'expert_1');
    const definitionContext = {
      context_strategy: 'minimal',
      enable_notes: true,
    };
    const executionContext = {
      expert_id: 'expert_1',
      user_id: 'user_1',
      topicId: null,
      accessToken: null,
      memorySystem: null,
      taskContext: null,
      session: null,
      agent_invocation: null,
    };

    const definitions = await manager.getToolDefinitions(definitionContext);
    expect(toolNames(definitions)).to.include('notes_take');

    const blocked = await manager.executeTool(
      'notes_take',
      { key: 'execution-gate', content: 'blocked without flags' },
      executionContext
    );
    expect(blocked.success).to.equal(false);
    expect(blocked.error).to.include('minimal context strategy');

    const store = new MemoryNotesStore();
    manager._notesStore = store;
    const allowed = await manager.executeTool(
      'notes_take',
      { key: 'execution-gate', content: 'allowed with flags' },
      {
        ...executionContext,
        ...definitionContext,
      }
    );

    expect(allowed.success).to.equal(true);
    store.stopCleanupTimer();
  });

  it('clamps relevance, reports overwrite, and rejects oversized content', async () => {
    const store = new MemoryNotesStore();
    const manager = new ToolManager({ getModel: () => null }, 'expert_1');
    manager._notesStore = store;
    const context = { userId: 'user_1', expertId: 'expert_1', context_strategy: 'minimal', enable_notes: true };

    const first = await manager.executeNotesTool(
      'notes_take',
      { key: 'k', content: 'short note', relevance: 5 },
      context,
      'notes_take'
    );
    const second = await manager.executeNotesTool(
      'notes_take',
      { key: 'k', content: 'updated note', relevance: -1 },
      context,
      'notes_take'
    );
    const oversized = await manager.executeNotesTool(
      'notes_take',
      { key: 'large', content: 'x'.repeat(4001) },
      context,
      'notes_take'
    );
    const note = await store.read('user_1', 'expert_1', 'k');

    expect(first.success).to.equal(true);
    expect(first.relevance).to.equal(1);
    expect(first.overwritten).to.equal(false);
    expect(second.success).to.equal(true);
    expect(second.relevance).to.equal(0);
    expect(second.overwritten).to.equal(true);
    expect(note.metadata.relevance).to.equal(0);
    expect(oversized.success).to.equal(false);
    expect(oversized.error).to.include('4000');
    store.stopCleanupTimer();
  });

  it('touches notes on read through NotesManager', async () => {
    const calls = [];
    const store = {
      read: async () => ({ content: 'note', type: 'note', metadata: {} }),
      touch: async (_userId, _expertId, key, ttl) => {
        calls.push({ key, ttl });
        return true;
      },
    };
    const manager = new NotesManager(store, { ttl: 123 });

    const note = await manager.read('user_1', 'expert_1', 'k');

    expect(note.content).to.equal('note');
    expect(calls).to.deep.equal([{ key: 'k', ttl: 123 }]);
  });

  it('uses listWithDetails for notes_list without read N+1', async () => {
    const manager = new ToolManager({ getModel: () => null }, 'expert_1');
    manager._notesStore = {
      listWithDetails: async () => [{
        key: 'k',
        content: 'content',
        type: 'note',
        metadata: { relevance: 0.7, saved_at: '2026-08-02T00:00:00.000Z' },
      }],
      list: async () => {
        throw new Error('list should not be called');
      },
      read: async () => {
        throw new Error('read should not be called');
      },
    };

    const result = await manager.executeNotesTool(
      'notes_list',
      {},
      { userId: 'user_1', expertId: 'expert_1', context_strategy: 'minimal', enable_notes: true },
      'notes_list'
    );

    expect(result.success).to.equal(true);
    expect(result.count).to.equal(1);
    expect(result.notes[0].key).to.equal('k');
  });

  it('routes note_* aliases through the shared host NotesStore', async () => {
    const store = new MemoryNotesStore();
    const manager = new ToolManager({ getModel: () => null }, 'expert_1');
    manager._notesStore = store;
    const context = {
      userId: 'user_1',
      expertId: 'expert_1',
      context_strategy: 'minimal',
      enable_notes: true,
    };

    const saved = await manager.executeTool('note_take', {
      key: 'alias-key',
      content: 'saved through note_take',
    }, context);
    const read = await manager.executeTool('notes_read', { key: 'alias-key' }, context);
    const listed = await manager.executeTool('note_list', {}, context);
    const forgotten = await manager.executeTool('note_forget', { key: 'alias-key' }, context);
    const afterForget = await store.read('user_1', 'expert_1', 'alias-key');

    expect(saved.success).to.equal(true);
    expect(read.success).to.equal(true);
    expect(read.content).to.equal('saved through note_take');
    expect(listed.success).to.equal(true);
    expect(listed.notes.map(note => note.key)).to.include('alias-key');
    expect(forgotten.success).to.equal(true);
    expect(afterForget).to.equal(null);
    store.stopCleanupTimer();
  });

  it('keeps note aliases visible to child agents through scoped ToolManager definitions', async () => {
    const manager = new ToolManager({ getModel: () => null }, 'expert_1');
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
        tools: ['note_take', 'notes_read'],
      },
    });

    expect(toolNames(tools).sort()).to.deep.equal(['note_take', 'notes_read']);
  });

  it('hides note tools from child agents when psyche_config disables notes', async () => {
    const manager = new ToolManager({ getModel: () => null }, 'expert_1');
    const tools = await getExpertChildScopedTools({
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
        tools: ['note_take', 'notes_read'],
      },
    });

    expect(tools).to.deep.equal([]);
  });
});
