import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SkillDescriptorRunner, resolvePythonCommand, validateSkillDefinition } from '../lib/skill-descriptor-runner.js';

function makeTempSkill(name, entrypoint, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  fs.writeFileSync(path.join(root, entrypoint), source, 'utf8');
  return root;
}

async function testNodeDescriptor() {
  const skillPath = makeTempSkill('descriptor-node', 'index.js', `
    module.exports = {
      getSkillDefinition() {
        return {
          schema_version: 1,
          skill: { id: 'demo-node', runtime: 'node', entrypoint: 'index.js' },
          descriptor_secret_probe: process.env.DB_PASSWORD || null,
          tools: [{
            name: 'describe',
            description: 'descriptor test',
            parameters: { type: 'object', properties: {}, required: [] },
            script_path: 'index.js'
          }]
        };
      }
    };
  `);

  const runner = new SkillDescriptorRunner({ timeoutMs: 3000 });
  const { descriptor } = await runner.describe({ skillPath });

  assert.equal(descriptor.schema_version, 1);
  assert.equal(descriptor.skill.id, 'demo-node');
  assert.equal(descriptor.descriptor_secret_probe, null);
  assert.equal(descriptor.tools[0].name, 'describe');
}

async function testLegacyNodeDescriptor() {
  const skillPath = makeTempSkill('descriptor-legacy', 'index.js', `
    module.exports = {
      getTools() {
        return [{ name: 'legacy_tool', description: 'legacy', parameters: { type: 'object' } }];
      }
    };
  `);

  const runner = new SkillDescriptorRunner({ timeoutMs: 3000 });
  const { descriptor } = await runner.describe({ skillPath });

  assert.equal(descriptor.schema_version, 0);
  assert.equal(descriptor.legacy_descriptor, true);
  assert.equal(descriptor.tools[0].name, 'legacy_tool');
}

async function testPythonDescriptorIfAvailable() {
  const probe = spawnSync(resolvePythonCommand(), ['--version'], {
    stdio: 'ignore',
    timeout: 1500,
    windowsHide: true,
  });

  if (probe.error || probe.status !== 0) {
    console.log(`Python descriptor integration test skipped: configured interpreter is unavailable (${resolvePythonCommand()}); set PYTHON_PATH to a usable Python executable.`);
    return;
  }

  const skillPath = makeTempSkill('descriptor-python', 'index.py', `
import json
import sys

def getSkillDefinition():
    return {
        "schema_version": 1,
        "skill": {"id": "demo-python", "runtime": "python", "entrypoint": "index.py"},
        "tools": [{
            "name": "describe",
            "description": "descriptor test",
            "parameters": {"type": "object", "properties": {}, "required": []},
            "script_path": "index.py"
        }]
    }

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] != "--get-definition":
        raise SystemExit("descriptor mode required")
    print(json.dumps(getSkillDefinition(), ensure_ascii=False))
  `);

  const runner = new SkillDescriptorRunner({ timeoutMs: 3000 });
  const { descriptor } = await runner.describe({ skillPath });

  assert.equal(descriptor.schema_version, 1);
  assert.equal(descriptor.skill.id, 'demo-python');
}

function testDescriptorValidation() {
  assert.throws(
    () => validateSkillDefinition({
      schema_version: 1,
      skill: { id: 'invalid', runtime: 'node', entrypoint: 'index.js' },
      tools: [{ name: 'duplicate', script_path: 'index.js' }, { name: 'duplicate', script_path: 'index.js' }],
    }),
    /Duplicate skill tool name/
  );

  assert.throws(
    () => validateSkillDefinition({
      schema_version: 1,
      skill: { id: 'invalid', runtime: 'node', entrypoint: 'index.js' },
      tools: [{ name: 'escape', script_path: '../outside.js' }],
    }),
    /escapes the skill root/
  );
}

await testNodeDescriptor();
await testLegacyNodeDescriptor();
await testPythonDescriptorIfAvailable();
testDescriptorValidation();
console.log('Skill descriptor runner tests passed.');
