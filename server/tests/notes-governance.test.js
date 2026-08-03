import { expect } from 'chai';
import ToolManager from '../../lib/tool-manager.js';
import NotesManager from '../../lib/notes/notes-manager.js';
import { MemoryNotesStore } from '../../lib/psyche-store/memory-store.js';

function toolNames(tools) {
  return tools.map(tool => tool.function?.name).filter(Boolean);
}

describe('notes governance', () => {
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

    expect(fullNames).not.to.include('notes.take');
    expect(minimalNames).to.include('notes.take');
    expect(minimalNames).to.include('notes.read');
    expect(minimalNames).to.include('notes.list');
    expect(disabledNames).not.to.include('notes.take');
  });

  it('rejects direct notes execution outside minimal strategy', async () => {
    const manager = new ToolManager({ getModel: () => null }, 'expert_1');
    const result = await manager.executeNotesTool(
      'notes.take',
      { key: 'k', content: 'content' },
      { userId: 'user_1', expertId: 'expert_1', context_strategy: 'full', enable_notes: true },
      'notes.take'
    );

    expect(result.success).to.equal(false);
    expect(result.error).to.include('minimal context strategy');
  });

  it('clamps relevance, reports overwrite, and rejects oversized content', async () => {
    const store = new MemoryNotesStore();
    const manager = new ToolManager({ getModel: () => null }, 'expert_1');
    manager._notesStore = store;
    const context = { userId: 'user_1', expertId: 'expert_1', context_strategy: 'minimal', enable_notes: true };

    const first = await manager.executeNotesTool(
      'notes.take',
      { key: 'k', content: 'short note', relevance: 5 },
      context,
      'notes.take'
    );
    const second = await manager.executeNotesTool(
      'notes.take',
      { key: 'k', content: 'updated note', relevance: -1 },
      context,
      'notes.take'
    );
    const oversized = await manager.executeNotesTool(
      'notes.take',
      { key: 'large', content: 'x'.repeat(4001) },
      context,
      'notes.take'
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

  it('uses listWithDetails for notes.list without read N+1', async () => {
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
      'notes.list',
      {},
      { userId: 'user_1', expertId: 'expert_1', context_strategy: 'minimal', enable_notes: true },
      'notes.list'
    );

    expect(result.success).to.equal(true);
    expect(result.count).to.equal(1);
    expect(result.notes[0].key).to.equal('k');
  });
});
