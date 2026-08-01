import { expect } from 'chai';
import { estimateMessagesTokens, estimateTokens } from '../../lib/token-utils.js';

describe('token-utils', () => {
  it('estimates Chinese text with CJK-aware ratio', () => {
    const text = '测'.repeat(1000);
    const tokens = estimateTokens(text);

    expect(tokens).to.be.within(500, 900);
  });

  it('handles null, object and multimodal content safely', () => {
    expect(estimateTokens(null)).to.equal(0);
    expect(() => estimateTokens({ nested: { value: '测试' } })).not.to.throw();

    const tokens = estimateTokens([
      { type: 'text', text: '一段中文文本' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ]);

    expect(tokens).to.be.greaterThan(1000);
  });

  it('includes inner_voice, tool_calls and reasoning_content in message estimates', () => {
    const base = estimateMessagesTokens([{ role: 'assistant', content: '正文' }]);
    const enriched = estimateMessagesTokens([{
      role: 'assistant',
      content: '正文',
      inner_voice: { feeling: '谨慎' },
      tool_calls: [{ name: 'recall', arguments: { q: '历史' } }],
      reasoning_content: '推理过程',
    }]);

    expect(enriched).to.be.greaterThan(base);
  });
});
