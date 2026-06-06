/**
 * Context Composer - 上下文组装层（Phase 4 WP-1）
 *
 * 负责系统提示构建，不包含策略判断逻辑。
 * Evidence Packet 注入规则集中管理。
 */

import logger from '../logger.js';

export class ContextComposer {
  constructor(options = {}) {
    this.config = {
      snippetMaxLength: options.snippetMaxLength || 200,
      snippetMaxCount: options.snippetMaxCount || 5,
    };
  }

  /**
   * 将 Evidence Packet 注入到系统提示
   * @param {Array} messages - LLM messages 数组
   * @param {EvidencePacket} evidencePacket - 证据包
   * @returns {Array} 修改后的 messages（副作用）
   */
  injectEvidence(messages, evidencePacket) {
    if (!evidencePacket?.items?.length) return messages;

    const msgItems = evidencePacket.items.filter(e => e.source === 'message' && e.snippet);
    if (msgItems.length === 0) return messages;

    const lines = msgItems
      .slice(0, this.config.snippetMaxCount)
      .map(e => `- [引用] [${e.role || 'unknown'}] ${this._sanitizeSnippet(e.snippet, this.config.snippetMaxLength)}`);

    const section = `\n\n【历史回忆线索】\n${lines.join('\n')}\n请基于以上历史信息回答问题。`;

    const sysMsg = messages.find(m => m.role === 'system');
    if (sysMsg) {
      sysMsg.content += section;
    } else {
      messages.unshift({ role: 'system', content: section });
    }

    return messages;
  }

  /**
   * 注入证据不足提示
   */
  injectDegradeNotice(messages) {
    const sysMsg = messages?.find(m => m.role === 'system');
    if (sysMsg) {
      sysMsg.content += '\n\n注意：当前无法获取完整历史信息，请在回答中说明不确定性。';
    }
    return messages;
  }

  /**
   * 指令去权重：给 snippet 加引用标记，防止 prompt injection
   */
  _sanitizeSnippet(text, maxLength) {
    return text
      .replace(/^#+\s*/gm, '')     // 去除 markdown 标题
      .replace(/```[\s\S]*?```/g, '[代码块]') // 替换代码块
      .slice(0, maxLength);
  }
}

export default ContextComposer;
