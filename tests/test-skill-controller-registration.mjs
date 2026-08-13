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

  async findAll() {
    return this.rows.map(row => ({ ...row }));
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
let staticListSkillPath = null;
let createdSkillPath = null;
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

  staticListSkillPath = fs.mkdtempSync(path.join(getSkillsPath(), 'controller-list-static-'));
  fs.writeFileSync(path.join(staticListSkillPath, 'index.js'), `
    module.exports = {
      getSkillDefinition() {
        throw new Error('listDirectories must not execute skill descriptors');
      }
    };
  `, 'utf8');
  db.models.get('skill').rows.push({
    name: 'controller-list-static',
    description: 'cached description',
    source_path: `skills/${path.basename(staticListSkillPath)}`,
  });

  const directoryResponse = {};
  await controller.listDirectories({
    success(data) {
      directoryResponse.data = data;
    },
    error(message, status) {
      throw new Error(`Unexpected directory list error (${status}): ${message}`);
    },
  });

  const listed = directoryResponse.data.directories.find(
    directory => directory.name === path.basename(staticListSkillPath)
  );
  assert.equal(listed.description, 'cached description');
  assert.equal(listed.descriptor_status, 'ready');
  assert.equal(listed.entrypoint, 'index.js');

  const createdName = `controller-created-${Date.now()}`;
  createdSkillPath = path.join(getSkillsPath(), createdName);
  const createResponse = {};
  await controller.createDirectory({
    request: { body: { name: createdName, description: 'generated skill' } },
    success(data) {
      createResponse.data = data;
    },
    error(message, status) {
      throw new Error(`Unexpected directory create error (${status}): ${message}`);
    },
  });
  assert.equal(createResponse.data.name, createdName);
  assert.equal(fs.existsSync(path.join(createdSkillPath, 'index.js')), true);
  assert.equal(fs.existsSync(path.join(createdSkillPath, 'SKILL.md')), false);
} finally {
  fs.rmSync(skillPath, { recursive: true, force: true });
  if (staticListSkillPath) {
    fs.rmSync(staticListSkillPath, { recursive: true, force: true });
  }
  if (createdSkillPath) {
    fs.rmSync(createdSkillPath, { recursive: true, force: true });
  }
}

console.log('Skill controller registration tests passed.');
