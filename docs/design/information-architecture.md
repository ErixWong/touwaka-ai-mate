# docs 信息架构与放置规则

本文档定义 `docs/`，尤其是 `docs/design/` 的信息架构规则，用来回答三个问题：

1. 什么文档应该放在哪里。
2. 哪些目录代表当前主线，哪些只是专题、草稿或历史遗留。
3. 当目录命名与文档内容演进不一致时，应该如何治理。

## 一、治理目标

- 让读者能快速区分“当前实现依据”和“历史参考材料”。
- 让新增文档有明确落点，避免同一主题散落多个目录。
- 通过语义化目录而不是阶段号堆叠，降低后续维护成本。

## 二、当前目录分工

### 1. `docs/development/`

放置当前仍然有效的开发规范与实现手册，例如编码规范、审查清单、API 参考、核心模块说明。

### 2. `docs/database/`

放置数据库初始化、升级、查询规范、模型生成相关说明。

### 3. `docs/apps/`

放置 App 平台的当前实现文档入口。

规则：

- 如果文档是“现行 app 平台怎么做”的实现说明，优先放这里。
- 如果文档是 App 平台的历史设计阶段材料，优先放到 `docs/apps/historical/` 或 `docs/design/archive/`，不再新增独立 `docs/design/app-platform/`。

### 4. `docs/design/`

放置架构设计、平台设计、专题设计、草稿与历史归档。

当前外层结构固定为：

```text
design/
├── core/
├── doc-platform/
├── topics/
├── drafts/
└── archive/
```

## 三、`docs/design/` 的放置规则

### 1. `core/`

用于放置系统主线架构与基础设施设计。

包含：

- 原 `phase1/`：Mind Core
- 原 `phase2/`：Task Layer / Right Panel
- 仍然属于核心基础设施的横切设计，如消息流、上下文组织、驻留进程管理

规则：

- 阶段主线设计继续保留在 `core/phase1/`、`core/phase2/`。
- 新增核心主线设计时，优先判断是否属于 `phase1/phase2` 的延续；若是，则进入对应子目录。
- 不再把 `phase1/phase2` 直接挂在 `design/` 根目录下。

### 2. `topics/`

用于放置跨阶段横切专题设计。

当前已划分的专题包括：

- `knowledge-base/`
- `resident-processes/`
- `chat/`
- `skills/`
- `attachment/`
- `contract-mgr/`

规则：

- 不属于某一阶段主线，但主题边界清晰、可以独立维护的设计，放入 `topics/`。
- 新增专题时，优先创建语义化子目录，不再新增 `parse5`、`parse6` 一类目录。

### 3. `doc-platform/`

用于放置**当前已经落地**的文档平台实现说明。

适用场景：

- `/api/docs` 路由体系
- `documents` / `document_revisions` / `document_outlines` / `document_chunks` 实现链路
- 文档处理流水线的真实代码落点

规则：

- 这里只有在代码里已经存在的文档平台实现说明。
- 未落地的文档智能产品设想，仍应保留在 `drafts/`，不能替代现有实现说明。

### 4. `drafts/`

放置尚未稳定、仍在探索中的草稿或工作文档。

规则：

- 草稿成熟后，要么进入 `core/`、`topics/`，要么归档；App 平台现行说明应进入 `docs/apps/`。

### 5. `archive/`

放置已完成使命的历史材料。

适用对象：

- 已废弃设计
- 已完成的审查报告
- 被新方案取代但仍需留存追溯价值的文档

## 四、历史命名治理

### 1. `phase1/phase2/phase3`

这些命名仍然保留，但只作为部分内部阶段子目录使用：

- `core/phase1/`
- `core/phase2/`

其中 `phase3/` 不再保留为现行目录层级；相关历史材料应迁入 `docs/apps/historical/` 或 `docs/design/archive/`。

### 2. `parse4/`

`parse4/` 已不再视为主线阶段，而是合同管理后续专题材料，现已吸收到：

- `topics/contract-mgr/`

规则：

- 保留历史文档语义，但不再保留单独 `parse4/` 目录壳。
- 任何新索引都必须把它解释为“合同管理专题”，不能再表述为新阶段。

### 3. `v2/`

原 `v2/` 目录已停止作为阶段目录使用。

规则：

- `v2/` 不能再作为 Phase 2 的别名。
- 其中仍有价值的内容要么并入 `core/`，要么归档。

## 五、独立专题文档的放置规则

如果文档既不属于核心主线，也不属于 App 平台主线，但主题边界清晰，则应归入 `topics/` 下的语义化子目录。

只有以下两类文档允许继续留在 `design/` 根目录：

- `README.md`
- `information-architecture.md`
- 具有“全局背景资料”性质、且暂不值得单独开目录的材料，例如 `references-analysis-report.md`

## 六、目录命名规则

- 外层目录统一使用语义化命名：`core`、`doc-platform`、`topics`、`drafts`、`archive`
- 阶段号只保留在确有必要的子目录层：当前为 `phase1`、`phase2`
- 不再新增新的 `parse{n}` 命名
- 不再使用 `v1` / `v2` 指代阶段目录
- README 作为目录入口时，必须解释该目录的定位、边界和推荐阅读顺序

## 七、新增文档决策流程

新增文档时按以下顺序判断：

1. 这是当前开发规范吗？
   - 是：放 `docs/development/`
2. 这是数据库/迁移/查询说明吗？
   - 是：放 `docs/database/`
3. 这是当前 app 平台实现手册吗？
   - 是：放 `docs/apps/`
4. 这是系统核心主线设计吗？
   - 是：放 `docs/design/core/` 或对应 `phase1/phase2/`
5. 这是 App 平台当前实现手册吗？
   - 是：放 `docs/apps/`
6. 这是 App 平台历史设计材料吗？
   - 是：放 `docs/apps/historical/` 或 `docs/design/archive/`
7. 这是跨阶段专题设计吗？
   - 是：放 `docs/design/topics/<topic>/`
8. 这是探索稿吗？
   - 是：放 `docs/design/drafts/`
9. 这是历史材料吗？
   - 是：放 `docs/design/archive/`

## 八、当前治理结论

- `core/` 是系统主线架构与基础设施设计的主入口。
- `docs/apps/` 是 App 平台当前实现的主入口。
- App 平台旧设计稿不再保留独立主入口。
- `topics/` 是跨阶段专题设计的统一收纳层。
- 当前优先级是用语义化目录稳定结构，减少继续新增阶段命名的冲动。

## 九、后续建议

1. 继续审查 `drafts/` 中高价值文档，决定并入主线、转专题或归档。
2. 逐步清理仍带有旧命名口径的正文描述，但不必为此反复大搬迁。
3. 所有新索引文档都应引用本规则，避免命名体系再次分叉。

---

*最后更新: 2026-06-27*
