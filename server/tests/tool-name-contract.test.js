import { expect } from 'chai';
import ToolManager from '../../lib/tool-manager.js';
import { AGENT_DELEGATE_TOOL_NAMES } from '../../lib/agent/agent-delegate-control-facade.js';

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function toolNames(tools) {
  return tools.map(tool => tool.function?.name);
}

describe('tool name contract', () => {
  it('exposes only provider-compatible names', async () => {
    const manager = new ToolManager(null, 'expert_1');
    const definitions = await manager.getToolDefinitions({
      context_strategy: 'minimal',
      enable_notes: true,
    });
    const names = [
      ...toolNames(definitions),
      ...Object.values(AGENT_DELEGATE_TOOL_NAMES),
    ];
    const invalidNames = names.filter(name => (
      typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)
    ));

    expect(invalidNames, `Invalid tool name(s): ${invalidNames.map(name => JSON.stringify(name)).join(', ')}`)
      .to.deep.equal([]);
  });
});
