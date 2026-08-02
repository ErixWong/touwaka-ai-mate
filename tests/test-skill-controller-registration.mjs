import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getSkillsPath } from '../lib/paths.js';
import SkillController from '../server/controllers/skill.controller.js';

class FakeModel {
  constructor() {
    this.rows = [];
  }

  async findOne({ where }) {
    const row = this.rows.find(candidate => Object.entries(where).every(([key, value]) => candidate[key] === value));
    return row ? { ...row } : null;
  }

  async upsert(row) {
    this.rows.push({ ...row });
  }

  async update() {}

  async destroy({ where }) {
    this.rows = this.rows.filter(row => !Object.entries(where).every(([key, value]) => row[key] === value));
  }

  async create(row) {
    this.rows.push({ ...row });
    return { ...row };
  }
}

function makeDb() {
  const models = new Map([
    ['skill', new FakeModel()],
    ['skill_tool', new FakeModel()],
    ['skill_parameter', new FakeModel()],
    ['user_skill_parameter', new FakeModel()],
  ]);
  return {
    models,
    getModel(name) {
      return models.get(name);
    },
    sequelize: {
      async transaction() {
        return { async commit() {}, async rollback() {} };
      },
    },
  };
}

const skillPath = fs.mkdtempSync(path.join(getSkillsPath(), 'controller-registration-'));
fs.writeFileSync(path.join(skillPath, 'index.js'), `
  module.exports = {
    getSkillDefinition() {
      return {
        schema_version: 1,
        skill: { id: 'controller-demo', name: 'controller-demo', runtime: 'node', entrypoint: 'index.js' },
        tools: [{ name: 'hello', description: 'hello', parameters: { type: 'object', properties: {} } }]
      };
    }
  };
`, 'utf8');

try {
  const db = makeDb();
  const controller = new SkillController(db);
  const response = {};

  await controller.register({
    request: { body: { source_path: path.basename(skillPath) } },
    success(data) {
      response.data = data;
    },
    error(message, status) {
      throw new Error(`Unexpected controller error (${status}): ${message}`);
    },
  });

  assert.equal(response.data.action, 'created');
  assert.equal(response.data.tools_registered, 1);
  assert.equal(db.models.get('skill_tool').rows[0].script_path, 'index.js');
} finally {
  fs.rmSync(skillPath, { recursive: true, force: true });
}

console.log('Skill controller registration tests passed.');
