/**
 * Static audit for skill tool parameter schemas exported in scripts/skills-data.json.
 *
 * Usage:
 *   node tests/test-skill-parameters-schema-quality.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import SkillLoader from '../lib/skill-loader.js';

const data = JSON.parse(fs.readFileSync('scripts/skills-data.json', 'utf-8'));
const loader = new SkillLoader({});
const tools = Array.isArray(data.tools) ? data.tools : [];

const rawDiffs = [];

for (const tool of tools) {
  const normalized = loader.normalizeParametersSchema(tool.parameters, tool.id);
  const properties = normalized.properties || {};
  const propertyNames = new Set(Object.keys(properties));

  assert.equal(normalized.type, 'object', `${tool.name} should normalize to an object schema`);
  assert.ok(!Array.isArray(properties), `${tool.name} properties must be an object`);
  assert.ok(Array.isArray(normalized.required), `${tool.name} required must be an array`);

  for (const requiredName of normalized.required) {
    assert.equal(typeof requiredName, 'string', `${tool.name} required entries must be strings`);
    assert.ok(propertyNames.has(requiredName), `${tool.name} required entry must exist in properties: ${requiredName}`);
  }

  for (const [propertyName, propertySchema] of Object.entries(properties)) {
    assert.equal(typeof propertySchema, 'object', `${tool.name}.${propertyName} schema must be an object`);
    assert.equal(propertySchema.required, undefined, `${tool.name}.${propertyName} must not use property-level required`);
  }

  if (JSON.stringify(tool.parameters || null) !== JSON.stringify(normalized)) {
    rawDiffs.push(`${tool.skill_id}/${tool.name}`);
  }
}

console.log(`Audited ${tools.length} skill tool schemas; ${rawDiffs.length} legacy schemas require runtime normalization.`);
if (rawDiffs.length > 0) {
  console.log(`Normalized legacy schemas: ${rawDiffs.join(', ')}`);
}
