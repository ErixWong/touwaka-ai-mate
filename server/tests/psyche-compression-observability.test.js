import { expect } from 'chai';
import { PsycheManager } from '../../lib/psyche/psyche-manager.js';
import { PsycheModel } from '../../lib/psyche/psyche-model.js';

describe('psyche compression observability', () => {
  it('records structured compression stats without changing the return contract', async () => {
    const notes = [];
    const manager = new PsycheManager(null, {
      take: async (userId, expertId, key, note) => {
        notes.push({ userId, expertId, key, note });
      },
    }, {
      maxNotesRefs: 2,
      maxTopicsContext: 1,
    });
    const psyche = PsycheModel.createEmpty();

    psyche.setTempNotes('temporary working memory '.repeat(20));
    psyche.notes_refs = [
      { id: 'n1', summary: 'important', relevance: 0.9 },
      { id: 'n2', summary: 'low', relevance: 0.2 },
      { id: 'n3', summary: 'medium', relevance: 0.7 },
    ];
    psyche.topics_context = [
      { topic_id: 't1', title: 'topic one', relevance: 0.9 },
      { topic_id: 't2', title: 'topic two', relevance: 0.8 },
    ];
    psyche.conversation_digest.key_exchanges = [
      { round: 1, summary: 'a'.repeat(80) },
      { round: 2, summary: 'b'.repeat(80) },
      { round: 3, summary: 'c'.repeat(80) },
      { round: 4, summary: 'd'.repeat(80) },
    ];

    const result = await manager.compress(psyche, 1, 'user_1', 'expert_1');
    const stats = manager.getLastCompressionStats();

    expect(result).to.equal(psyche);
    expect(notes).to.have.length(1);
    expect(stats.compressed).to.equal(true);
    expect(stats.tempNotesMoved).to.equal(true);
    expect(stats.notesRefs.initial).to.equal(3);
    expect(stats.notesRefs.addedFromTempNotes).to.equal(1);
    expect(stats.notesRefs.before).to.equal(4);
    expect(stats.notesRefs.after).to.equal(2);
    expect(stats.notesRefs.removed).to.equal(2);
    expect(stats.topicsContext.removed).to.equal(1);
    expect(stats.keyExchanges.removed).to.equal(1);
    expect(stats.finalTokens).to.be.a('number');
  });
});
