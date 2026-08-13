import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(repoRoot, 'data', 'skills');
const seedPath = path.join(repoRoot, 'scripts', 'skills-data.json');

function isFrozenDraft(skillPath) {
  const statusPath = path.join(skillPath, 'STATUS.md');
  if (!fs.existsSync(statusPath)) return false;
  return /^Status:\s*frozen draft\.?\s*$/im.test(fs.readFileSync(statusPath, 'utf8'));
}

function normalizeSourcePath(sourcePath) {
  return String(sourcePath || '').replaceAll('\\', '/');
}

const directories = fs.readdirSync(skillsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

const executableDirectories = directories.filter(name => !isFrozenDraft(path.join(skillsRoot, name)));
for (const name of executableDirectories) {
  const skillPath = path.join(skillsRoot, name);
  const entrypoints = ['index.js', 'index.py']
    .filter(entrypoint => fs.existsSync(path.join(skillPath, entrypoint)));

  assert.equal(
    entrypoints.length,
    1,
    `${name} must expose exactly one standard descriptor entrypoint (index.js or index.py)`,
  );
}

const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const seedSkillIds = new Set(seedData.skills.map(skill => skill.id));
const seedSourcePaths = seedData.skills.map(skill => normalizeSourcePath(skill.source_path));

assert.equal(
  new Set(seedSourcePaths).size,
  seedSourcePaths.length,
  'skills-data.json must not contain duplicate source_path entries',
);

for (const skill of seedData.skills) {
  const sourcePath = normalizeSourcePath(skill.source_path);
  assert.ok(sourcePath.startsWith('skills/'), `Seed source_path must start with skills/: ${sourcePath}`);
  const directoryName = sourcePath.slice('skills/'.length);
  const skillPath = path.join(skillsRoot, ...directoryName.split('/'));
  assert.ok(fs.existsSync(skillPath), `Seed skill directory does not exist: ${sourcePath}`);
  assert.equal(isFrozenDraft(skillPath), false, `Frozen draft must not be seeded: ${sourcePath}`);
}

for (const tool of seedData.tools) {
  assert.ok(seedSkillIds.has(tool.skill_id), `Seed tool references missing skill: ${tool.skill_id}`);
}

console.log(
  `Skill inventory consistency passed: ${executableDirectories.length} executable directories, `
  + `${seedData.skills.length} seeded skills, ${seedData.tools.length} seeded tools.`,
);
