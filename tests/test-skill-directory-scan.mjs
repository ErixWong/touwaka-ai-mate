/**
 * Tests for SkillLoader directory scanning and tool parameter schema normalization.
 *
 * Usage:
 *   node tests/test-skill-directory-scan.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import SkillLoader from '../lib/skill-loader.js';

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function testScanSkillsDirectory() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-directory-scan-'));
  const skillsBasePath = path.join(tempRoot, 'skills');

  try {
    writeFile(path.join(skillsBasePath, 'javascript-skill', 'SKILL.md'), '# JS Skill');
    writeFile(path.join(skillsBasePath, 'javascript-skill', 'index.js'), 'export default async function execute() {}');

    writeFile(path.join(skillsBasePath, 'python-skill', 'skill.md'), '# Python Skill');
    writeFile(path.join(skillsBasePath, 'python-skill', 'index.py'), 'def execute(*args, **kwargs):\n    return {}');

    writeFile(path.join(skillsBasePath, 'draft-skill', 'SKILL.md'), '# Draft Skill');
    writeFile(path.join(skillsBasePath, 'entry-only-skill', 'index.js'), 'export default async function execute() {}');
    writeFile(path.join(skillsBasePath, 'plain-file.txt'), 'ignored');

    const loader = new SkillLoader({}, { skillsBasePath });
    const discovered = await loader.scanSkillsDirectory();
    const ids = discovered.map(skill => skill.id).sort();

    assert.deepEqual(ids, ['entry-only-skill', 'javascript-skill', 'python-skill']);
    assert.ok(discovered.every(skill => path.isAbsolute(skill.path)));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function testMissingSkillsDirectory() {
  const missingBasePath = path.join(os.tmpdir(), `missing-skills-${Date.now()}`);
  const loader = new SkillLoader({}, { skillsBasePath: missingBasePath });

  return loader.scanSkillsDirectory().then(discovered => {
    assert.deepEqual(discovered, []);
  });
}

function testParameterSchemaNormalization() {
  const loader = new SkillLoader({});
  const skill = { id: 'skill-one', mark: 'skill', name: 'Skill One' };

  const tool = loader.convertToolToOpenAIFormat({
    id: 'tool-one',
    name: 'run',
    description: 'Run tool',
    parameters: JSON.stringify({
      type: 'array',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
          required: true,
        },
        count: {
          type: 'definitely-not-json-schema',
        },
        tags: {
          type: 'array',
        },
        body: {
          oneOf: [
            { type: 'string' },
            { type: 'object' },
          ],
          description: 'Flexible request body',
        },
        data: {
          description: 'Flexible chart data',
        },
      },
      required: ['query', 'body', 'data', 'missing'],
    }),
  }, skill);

  const schema = tool.function.parameters;

  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['query', 'body', 'data']);
  assert.equal(schema.properties.query.type, 'string');
  assert.equal(schema.properties.query.required, undefined);
  assert.equal(schema.properties.count.type, 'string');
  assert.equal(schema.properties.tags.type, 'array');
  assert.equal(schema.properties.tags.items, undefined);
  assert.deepEqual(schema.properties.body.oneOf, [
    { type: 'string' },
    { type: 'object' },
  ]);
  assert.equal(schema.properties.body.type, undefined);
  assert.equal(schema.properties.data.description, 'Flexible chart data');
  assert.equal(schema.properties.data.type, undefined);
}

async function main() {
  await testScanSkillsDirectory();
  await testMissingSkillsDirectory();
  testParameterSchemaNormalization();

  console.log('Skill directory scan and parameter schema tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
