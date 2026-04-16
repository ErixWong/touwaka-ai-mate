# Touwaka Mate v2 Documentation

Welcome to the Touwaka Mate v2 documentation. This is an AI Expert System with dual-mind architecture (Expression Mind + Reflective Mind).

## 📚 Documentation Structure

```
docs/
├── README.md                    # This file - documentation index
├── SOUL.md                      # Project guide with coding standards and conventions
├── CONTRIBUTING.md              # Contribution guidelines
├── function-calling-best-practices.md  # LLM function calling best practices
├── development/                 # Development guides
│   ├── quick-start.md          # Quick start guide
│   ├── coding-standards.md     # Coding standards and conventions
│   ├── core-modules.md         # Core module documentation
│   ├── frontend-components.md  # Frontend component guide
│   ├── api-reference.md        # API reference
│   ├── code-review-checklist.md # Code review checklist
│   └── skill-development-guide.md # Skill development guide
├── database/                    # Database documentation
│   ├── README.md               # Database overview
│   ├── api-query-design.md     # API query design patterns
│   └── orm-analysis.md         # ORM analysis
└── design/                     # Architecture and design documents
    ├── README.md               # Design documentation index
    ├── parse1/                 # Parse 1 architecture documents (formerly v1)
    ├── parse2/                 # Parse 2 architecture documents (formerly v2)
    └── parse3/                 # Parse 3 - App platform design
```

## 🚀 Quick Start

- **[Quick Start Guide](development/quick-start.md)** - Get started with development
- **[Coding Standards](development/coding-standards.md)** - Code conventions and standards
- **[API Reference](development/api-reference.md)** - API endpoints and usage

## 🏗️ Architecture

**Touwaka Mate v2** - AI Expert System

- **Expert**: AI characters with unique personas
- **Topic**: Phased summaries of conversation history
- **Skill**: Tool capabilities that experts can invoke
- **Dual-Mind Architecture**: Expression Mind + Reflective Mind

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vue 3 + TypeScript + Vite + Pinia |
| Backend | Node.js + Koa + MySQL |
| ORM | Sequelize |
| AI | LLM Application Development, Prompt Engineering |

## 📖 Key Documentation

### Development
- [Quick Start](development/quick-start.md) - Environment setup and first steps
- [Coding Standards](development/coding-standards.md) - Naming conventions, code style
- [Core Modules](development/core-modules.md) - ChatService, LLMClient, MemorySystem
- [Frontend Components](development/frontend-components.md) - UI components guide
- [API Reference](development/api-reference.md) - Endpoints and error codes
- [Skill Development Guide](development/skill-development-guide.md) - How to create skills

### Project Guide
- [SOUL.md](SOUL.md) - Project conventions, coding standards, and development guidelines

### Database
- [Database Overview](database/README.md) - Database design and setup
- [API Query Design](database/api-query-design.md) - Query patterns and best practices
- [ORM Analysis](database/orm-analysis.md) - ORM usage and patterns

### Design
- [Design Index](design/README.md) - Architecture documentation index
- [Parse 1 Design](design/parse1/README.md) - Parse 1 architecture and design
- [Parse 2 Design](design/parse2/README.md) - Parse 2 architecture (Task Layer, Right Panel, etc.)
- [Parse 3 - App Platform](design/parse3/app-platform-design.md) - App platform design (Bitable + AI)

## 🤝 Contributing

Please read our [Contributing Guide](CONTRIBUTING.md) for details on:
- Code of conduct
- Development workflow
- Pull request process
- Coding standards

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

---

*Last updated: 2026-03-30*
