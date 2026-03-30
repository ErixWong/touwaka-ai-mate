# Project Guide

This document contains essential project conventions, coding standards, and development guidelines for Touwaka Mate v2.

## Table of Contents

- [Project Overview](#project-overview)
- [Tech Stack](#tech-stack)
- [Code Conventions](#code-conventions)
- [Common Components](#common-components)
- [Git Workflow](#git-workflow)
- [Database Guidelines](#database-guidelines)
- [Development Tools](#development-tools)

## Project Overview

**Touwaka Mate v2** - AI Expert System

- **Expert**: AI characters with unique personas
- **Topic**: Phased summaries of conversation history
- **Skill**: Tool capabilities that experts can invoke
- **Dual-Mind Architecture**: Expression Mind + Reflective Mind

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vue 3 + TypeScript + Vite + Pinia |
| Backend | Node.js + Koa + MySQL |
| ORM | Sequelize |
| AI | LLM Application Development, Prompt Engineering |

## Code Conventions

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Database fields | `snake_case` | `user_id`, `created_at` |
| Frontend components | `PascalCase` | `UserPicker.vue`, `Toast.vue` |
| API routes | `kebab-case` | `/api/user-profiles` |
| JavaScript variables | `camelCase` | `userProfile`, `getData` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |

### Git Commit Format

**Format**: `#{issue}: type description`

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code refactoring |
| `docs` | Documentation changes |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks |

**Examples**:
```
#123: feat add user authentication
#124: fix resolve memory leak in chat service
#125: docs update API reference
```

### PR Title Format

```
type: Description (without issue number)
```

Use `Closes #<issue-number>` in the PR body to link issues.

## Common Components

### Location

Common components are located at `frontend/src/components/common/`

| Component | Purpose | Example |
|-----------|---------|---------|
| `Toast.vue` | Message notifications (replaces alert) | `toast.success('Operation successful')` |
| `UserPicker.vue` | User selector (Modal popup) | `<UserPicker v-model="userId" @change="handleChange" />` |

> **Note**: `Pagination.vue` is located at `frontend/src/components/`, not in `common/`

### Toast Usage

```typescript
import { useToastStore } from '@/stores/toast'
const toast = useToastStore()
toast.success('Operation successful')
toast.error('Operation failed')
toast.warning('Warning message')
toast.info('Info message')
```

### UserPicker Usage

```vue
<template>
  <UserPicker
    v-model="selectedUserId"
    :placeholder="'Select user'"
    :disabled="false"
    @change="handleUserChange"
  />
</template>

<script setup lang="ts">
import UserPicker from '@/components/common/UserPicker.vue'
import type { UserListItem } from '@/types'

const selectedUserId = ref<string | null>(null)

const handleUserChange = (user: UserListItem | null) => {
  console.log('Selected user:', user)
}
</script>
```

### Pagination Usage

```vue
<template>
  <Pagination
    v-if="totalPages > 1"
    :currentPage="currentPage"
    :totalPages="totalPages"
    :total="total"
    @change="handlePageChange"
  />
</template>

<script setup lang="ts">
import Pagination from '@/components/Pagination.vue'

const currentPage = ref(1)
const totalPages = ref(10)
const total = ref(100)

const handlePageChange = (page: number) => {
  currentPage.value = page
  // Reload data
}
</script>
```

## Git Workflow

### Branch Strategy

**Naming convention**: `{type}/{issue-number}-{short-description}`

| Type | Description |
|------|-------------|
| `feature` | New feature or enhancement |
| `fix` | Bug fix |
| `refactor` | Code refactoring |
| `docs` | Documentation changes |

**Examples**:
- `feature/15-knowledge-import`
- `fix/42-login-error`
- `refactor/30-skill-loader`

### Workflow

```
Create Branch → Modify Code → Push Branch → Create PR
   (isolate)     (develop)      (upload)     (request merge)
```

### Steps

1. **Create Issue**: Describe requirements/problem, add Labels
2. **Create Branch**: From `master`, follow naming convention
3. **Develop**: Write code, commit with format `#{issue}: type description`
4. **Create PR**: Use `Closes #<issue-number>` in description
5. **Merge**: Squash merge to `master`, delete branch
6. **Issue Auto-close**: PR merge automatically closes linked Issue

## Database Guidelines

### Field Types

| Type | Use Case | Example |
|------|----------|---------|
| `BIT(1)` | Boolean fields | `is_active`, `is_enabled`, `is_public` |
| `INT` | Integers | `count`, `position`, `token_count` |
| `VARCHAR(n)` | Short text | `name`, `title`, `code` |
| `TEXT` | Long text | `description`, `content` |
| `LONGTEXT` | Very long text | `prompt_template`, `result` |
| `ENUM(...)` | Enumerated values | `status`, `role`, `type` |
| `JSON` | JSON data | `metadata`, `tags` |
| `VECTOR(n)` | Vector data | `embedding` |

> **⚠️ Do not use `TINYINT`!** Use `BIT(1)` for booleans, `INT` for integers.

### Migration Process

**All migrations use `scripts/upgrade-database.js`**

```bash
# Execute database upgrade (idempotent)
node scripts/upgrade-database.js

# Regenerate models
node scripts/generate-models.js
```

### Migration Rules

1. **Idempotency**: Each migration must have a `check` function
2. **Safe execution**: Use `safeExecute()` to catch "already exists" errors
3. **Foreign keys**: Create complete foreign key relationships for new tables
4. **One-time execution**: Add new migrations to the end of `MIGRATIONS` array

## Development Tools

| Script | Purpose | Example |
|--------|---------|---------|
| `run-skill.js` | Execute skill code directly | `node tests/run-skill.js kb-search search --kb_id=xxx` |
| `skill-admin.js` | Manage skills (register/assign/enable/disable) | `node tests/skill-admin.js skill list` |
| `db-query.js` | Direct database queries | `node tests/db-query.js kb_articles --limit=10` |

Authentication: `run-skill.js` and `skill-admin.js` auto-generate admin JWT; `db-query.js` connects directly to database.

---

*Happy coding! 💪✨*
