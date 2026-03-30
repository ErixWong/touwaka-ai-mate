# Contributing to Touwaka Mate v2

Thank you for your interest in contributing to Touwaka Mate v2! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Code Review](#code-review)

## Code of Conduct

This project and everyone participating in it is governed by our commitment to:
- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Accept responsibility and apologize when mistakes happen

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Set up the development environment** following the [Quick Start Guide](development/quick-start.md)
4. **Create a branch** for your changes

## Development Workflow

### Branch Strategy

We use a feature branch workflow:

```
master (protected)
  ↑
feature/123-description  ← your feature branch
```

**Branch naming convention**: `{type}/{issue-number}-{short-description}`

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

### Creating a Branch

```bash
# From master
git checkout master
git pull origin master

# Create your feature branch
git checkout -b feature/123-my-feature
```

## Coding Standards

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Database fields | `snake_case` | `user_id`, `created_at` |
| Frontend components | `PascalCase` | `UserPicker.vue`, `Toast.vue` |
| API routes | `kebab-case` | `/api/user-profiles` |
| JavaScript variables | `camelCase` | `userProfile`, `getData` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |

### Database Field Types

| Type | Use Case | Example |
|------|----------|---------|
| `BIT(1)` | Boolean fields | `is_active`, `is_enabled` |
| `INT` | Integers | `count`, `position` |
| `VARCHAR(n)` | Short text | `name`, `title` |
| `TEXT` | Long text | `description`, `content` |
| `LONGTEXT` | Very long text | `prompt_template`, `result` |
| `ENUM(...)` | Enumerated values | `status`, `role` |
| `JSON` | JSON data | `metadata`, `tags` |

> **Note**: Use `BIT(1)` for booleans, not `TINYINT`.

### Code Style

- Use 2 spaces for indentation
- Use single quotes for strings
- Add trailing commas in multi-line objects/arrays
- Maximum line length: 100 characters
- Use meaningful variable names

### Response Format

All API responses should follow this structure:

```javascript
// Success
{
  "success": true,
  "data": { ... }
}

// Error
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

## Commit Message Guidelines

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

## Pull Request Process

1. **Ensure your code passes all tests**
2. **Update documentation** if needed
3. **Create a Pull Request** on GitHub
4. **Link the issue** using `Closes #<issue-number>` in the PR description
5. **Request review** from maintainers

### PR Title Format

```
type: Description (without issue number)
```

**Examples**:
```
feat: Add user authentication system
fix: Resolve memory leak in chat service
docs: Update API reference documentation
```

### PR Description Template

```markdown
## Description
Brief description of changes

## Related Issue
Closes #123

## Changes Made
- Change 1
- Change 2
- Change 3

## Testing
How was this tested?

## Screenshots (if applicable)
```

## Code Review

All submissions require review before merging. The review process:

1. **Automated checks** must pass (CI/CD)
2. **Code review** by at least one maintainer
3. **Approval** required before merge
4. **Squash merge** to master

### Review Checklist

- [ ] Code follows style guidelines
- [ ] Tests pass
- [ ] Documentation updated
- [ ] No breaking changes (or properly documented)
- [ ] Security considerations addressed

## Questions?

If you have questions or need help:
- Open an issue for discussion
- Check existing documentation
- Review closed PRs for examples

Thank you for contributing! 🎉
