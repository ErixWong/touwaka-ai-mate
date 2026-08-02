import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillDescriptorRunner } from '../lib/skill-descriptor-runner.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(repoRoot, 'data', 'skills');

const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
const candidates = [];

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const skillPath = path.join(skillsRoot, entry.name);
  const hasNodeEntrypoint = await fs.access(path.join(skillPath, 'index.js')).then(() => true).catch(() => false);
  const hasPythonEntrypoint = await fs.access(path.join(skillPath, 'index.py')).then(() => true).catch(() => false);
  if (hasNodeEntrypoint || hasPythonEntrypoint) {
    candidates.push({
      name: entry.name,
      skillPath,
      entrypoint: hasNodeEntrypoint ? 'index.js' : 'index.py',
    });
  }
}

candidates.sort((left, right) => left.name.localeCompare(right.name));
assert.equal(candidates.length, 16, 'Unexpected executable skill count; update the migration inventory explicitly');

const runner = new SkillDescriptorRunner({
  timeoutMs: 30000,
});
const failures = [];

for (const candidate of candidates) {
  try {
    const result = await runner.describe({ skillPath: candidate.skillPath });
    const descriptor = result.descriptor;

    assert.equal(descriptor.schema_version, 1, `${candidate.name} must expose SkillDefinition v1`);
    assert.equal(descriptor.legacy_descriptor, undefined, `${candidate.name} must not use legacy descriptor fallback`);
    assert.equal(descriptor.skill.id, candidate.name, `${candidate.name} descriptor id mismatch`);
    assert.equal(descriptor.skill.entrypoint, candidate.entrypoint, `${candidate.name} entrypoint mismatch`);
    assert.ok(Array.isArray(descriptor.skill.scenarios), `${candidate.name} scenarios must be an array`);
    assert.ok(Array.isArray(descriptor.tools), `${candidate.name} tools must be an array`);
    const toolNames = new Set(descriptor.tools.map(tool => tool.name));
    for (const scenario of descriptor.skill.scenarios) {
      assert.equal(typeof scenario.id, 'string', `${candidate.name} scenario id must be a string`);
      assert.equal(typeof scenario.description, 'string', `${candidate.name} scenario description must be a string`);
      assert.ok(Array.isArray(scenario.tools), `${candidate.name} scenario tools must be an array`);
      for (const toolName of scenario.tools) {
        assert.ok(toolNames.has(toolName), `${candidate.name} scenario references unknown tool ${toolName}`);
      }
    }
  } catch (error) {
    failures.push(`${candidate.name}: ${error.message}`);
  }
}

assert.deepEqual(failures, [], `Skill descriptor migration failures:\n${failures.join('\n')}`);
console.log(`All ${candidates.length} executable skills expose SkillDefinition v1`);
