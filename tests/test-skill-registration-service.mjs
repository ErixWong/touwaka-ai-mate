import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getSkillsPath } from '../lib/paths.js';
import { SkillRegistrationService } from '../server/services/skill-registration.service.js';

class FakeModel {
  constructor() {
    this.rows = [];
  }

  async findOne({ where }) {
    const row = this.rows.find(candidate => Object.entries(where).every(([key, value]) => candidate[key] === value));
    return row ? { ...row } : null;
  }

  async upsert(row) {
    const index = this.rows.findIndex(candidate => candidate.id === row.id);
    if (index >= 0) this.rows[index] = { ...this.rows[index], ...row };
    else this.rows.push({ ...row });
  }

  async update(values, { where }) {
    for (const row of this.rows) {
      if (Object.entries(where).every(([key, value]) => row[key] === value)) {
        Object.assign(row, values);
      }
    }
  }

  async destroy({ where }) {
    this.rows = this.rows.filter(row => !Object.entries(where).every(([key, value]) => row[key] === value));
  }

  async create(row) {
    this.rows.push({ ...row });
    return { ...row };
  }
}

function makeDb() {
  const models = {
    skill: new FakeModel(),
    skill_tool: new FakeModel(),
  };
  return {
    models,
    getModel(name) {
      return models[name];
    },
    sequelize: {
      async transaction() {
        return {
          async commit() {},
          async rollback() {},
        };
      },
    },
  };
}

const skillPath = fs.mkdtempSync(path.join(getSkillsPath(), 'registration-service-'));
fs.writeFileSync(path.join(skillPath, 'index.js'), `
  module.exports = {
    getSkillDefinition() {
      return {
        schema_version: 1,
        skill: {
          id: 'registration-demo',
          name: 'registration-demo',
          description: 'descriptor registration test',
          runtime: 'node',
          entrypoint: 'index.js'
        },
        tools: [{
          name: 'hello',
          description: 'hello tool',
          parameters: { type: 'object', properties: {}, required: [] }
        }]
      };
    }
  };
`, 'utf8');

try {
  const db = makeDb();
  const service = new SkillRegistrationService(db);
  const result = await service.register({
    sourcePath: path.basename(skillPath),
    fullPath: skillPath,
  });

  assert.equal(result.action, 'created');
  assert.equal(result.tools_registered, 1);
  assert.equal(db.models.skill.rows[0].source_path, `skills/${path.basename(skillPath)}`);
  assert.equal(db.models.skill_tool.rows[0].script_path, 'index.js');
  assert.equal(db.models.skill_tool.rows[0].is_resident, false);

  const second = await service.register({
    sourcePath: path.basename(skillPath),
    fullPath: skillPath,
  });
  assert.equal(second.action, 'updated');
  assert.equal(db.models.skill_tool.rows.length, 1);
} finally {
  fs.rmSync(skillPath, { recursive: true, force: true });
}

console.log('Skill registration service tests passed.');
