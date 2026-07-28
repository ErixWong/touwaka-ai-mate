/**
 * Static production registration checks for agent-child-runner.
 *
 * Usage:
 *   node tests/test-agent-child-runner-production-registration.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

function testSkillsDataRegistersResidentRunner() {
  const data = JSON.parse(fs.readFileSync('scripts/skills-data.json', 'utf8'));
  const skill = data.skills.find(item => item.id === 'agent-child-runner');
  const tool = data.tools.find(item => item.id === 'agent-child-runner-invoke');

  assert.ok(skill, 'agent-child-runner skill should be present in skills-data.json');
  assert.equal(skill.source_path, 'skills/agent-child-runner');
  assert.equal(skill.user_invocable, false);
  assert.equal(skill.disable_model_invocation, true);
  assert.equal(skill.is_active, true);

  assert.ok(tool, 'agent-child-runner-invoke tool should be present in skills-data.json');
  assert.equal(tool.skill_id, 'agent-child-runner');
  assert.equal(tool.name, 'invoke');
  assert.equal(tool.script_path, 'index.js');
  assert.equal(tool.is_resident, true);
  assert.deepEqual(tool.parameters.required, ['action']);
  assert.deepEqual(tool.parameters.properties.action.enum, ['start', 'status', 'result', 'events', 'cancel']);
}

function testUpgradeScriptRegistersResidentRunnerIdempotently() {
  const source = fs.readFileSync('scripts/upgrade-database.js', 'utf8');

  assert.match(source, /name:\s*'agent-child-runner\.skill_registration'/);
  assert.match(source, /agent-child-runner-invoke/);
  assert.match(source, /skills\/agent-child-runner/);
  assert.match(source, /ON DUPLICATE KEY UPDATE/);
  assert.match(source, /t\.is_resident = 1/);
}

function main() {
  testSkillsDataRegistersResidentRunner();
  testUpgradeScriptRegistersResidentRunnerIdempotently();

  console.log('Agent child runner production registration tests passed.');
}

main();
