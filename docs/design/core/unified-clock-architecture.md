# Unified Clock Architecture

## 1. 目标

当前平台同时存在两套定时调度体系：

1. `BackgroundTaskScheduler`
2. `AppClock`

两套体系可以运行，但已经暴露出明显问题：

- 平台内部 job 与业务 app tick 分裂
- 运行日志、失败语义、超时语义不统一
- `doc-ocr-pipeline` 这类平台内部状态机推进器被错误 app 化

本设计的目标是：

- 建立一套统一的 `Clock Core`
- 将所有周期性任务纳入统一调度模型
- 明确区分：
  - `internal_job`
  - `app_tick`
- 保留现有成熟业务 service，不做无意义重写

---

## 2. 核心结论

统一后的平台不再是：

- 一套 scheduler 管内部 job
- 一套 app clock 管 app tick

而是：

- **一套统一的 Clock Core**
- **两类任务模型**

```text
Clock Core
├── internal_job
└── app_tick
```

其中：

- `internal_job`：平台内部任务
- `app_tick`：业务 app 周期任务

app tick 不再是一套独立调度系统，而是统一 job 模型中的一个子类。

---

## 3. 任务分类模型

### 3.1 internal_job

适用于：

- 文档平台处理流水线
- document embedding worker
- topic archiver
- autonomous task executor
- 其他纯平台内部后台任务

特点：

- 不应注册为 `mini_apps`
- 不应暴露为普通业务 app
- 由平台内部模块直接提供 handler

### 3.2 app_tick

适用于：

- `ocr-tool`
- `contract-mgr`
- `contract-mgr-v2`
- `invoice-mgr`
- 其他需要周期性处理的业务 app

特点：

- 仍然属于 app
- 可继续从 app manifest / runtime 中发现 tick 入口
- 由统一 clock 以 app 子类 job 方式调度

---

## 4. 统一 Job 抽象

建议统一为以下抽象结构：

```ts
type ClockJob = {
  id: string
  kind: 'internal_job' | 'app_tick'
  name: string
  enabled: boolean
  schedule: {
    interval_ms: number
    immediate?: boolean
  }
  execution: {
    prevent_overlap?: boolean
    timeout_ms?: number
    max_consecutive_failures?: number
    cooldown_ms?: number
    retry_policy?: {
      mode: 'none' | 'fixed' | 'exponential'
      max_retries?: number
      retry_delay_ms?: number
    }
  }
  source: {
    type: 'internal_handler' | 'app_manifest_tick'
    ref: string
  }
  metadata?: {
    app_id?: string
    visibility?: 'system' | 'owner' | 'all'
    tags?: string[]
  }
}
```

说明：

- `kind` 区分内部任务与 app 任务
- `source` 描述执行入口来源
- `execution` 统一失败/超时/重叠控制

---

## 5. Clock Core 组成

建议统一成以下模块：

```text
lib/clock/
├── clock-core.js
├── job-registry.js
├── job-executor.js
├── job-context-builder.js
├── job-run-store.js
└── policies/
    ├── overlap-policy.js
    ├── cooldown-policy.js
    └── retry-policy.js
```

### 5.1 `clock-core.js`

职责：

- 统一调度主循环
- 定时唤醒
- 查询可运行 job
- 触发执行器

### 5.2 `job-registry.js`

职责：

- 注册/发现所有 job
- 区分 `internal_job` 与 `app_tick`
- 统一启停状态

### 5.3 `job-executor.js`

职责：

- 执行 job
- 处理 timeout / overlap / cooldown / retry
- 调用统一日志存储

### 5.4 `job-context-builder.js`

职责：

- 为不同类型 job 构造上下文
- 统一基础能力注入
- 按 job kind 追加专属能力

### 5.5 `job-run-store.js`

职责：

- 统一运行日志落盘
- 提供状态查询与排障基础

---

## 6. 上下文模型

### 6.1 internal_job context

```js
{
  kind: 'internal_job',
  db,
  sequelize,
  services: {
    query,
    execute,
    getModel,
    log,
    documentOcr,
    documentClean,
    documentOutline,
    documentChunk,
    documentEmbedding,
    callMcp,
    callLlm,
  }
}
```

### 6.2 app_tick context

```js
{
  kind: 'app_tick',
  db,
  sequelize,
  app,
  registry,
  services: {
    query,
    execute,
    getModel,
    log,
    callMcp,
    callSkill,
    callExtension,
    getFiles,
  }
}
```

说明：

- 统一的是构造机制，不是要求两类 context 完全相同
- 两类任务有共同基础能力，但保留各自必要差异

---

## 7. 日志与运行记录

当前存在：

- `app_tick_log`
- `app_tick_run`
- `BackgroundTaskScheduler` 自己的 console/log

最终建议统一为中性模型：

- `job_run`
- `job_log`

最少字段：

- `job_id`
- `job_kind`
- `app_id`（可空）
- `status`
- `started_at`
- `finished_at`
- `duration_ms`
- `error_message`
- `output_data`
- `trigger_type`

过渡期策略：

- 可继续复用 `app_tick_log` / `app_tick_run`
- 但从语义上先按 job 处理
- 表结构统一放到后续阶段迁移

---

## 8. 推荐迁移顺序

### Phase 0：冻结边界

目标：

- 平台内部状态机不得再 app 化

动作：

1. 规定内部流水线只能作为 `internal_job`
2. 新增业务 app 才允许走 `app_tick`

### Phase 1：抽统一执行内核

目标：

- 不改业务逻辑，先统一执行语义

动作：

1. 抽 `Clock Core`
2. 让 `BackgroundTaskScheduler` 与 `AppClock` 共用：
   - overlap
   - timeout
   - cooldown
   - retry
   - logging

#### Phase 1 实施蓝图

本阶段建议只落一个**最小可运行切片**，不要一上来把全部调度体系推倒重做。

##### 本轮新增文件

建议新增：

```text
lib/clock/clock-core.js
lib/clock/job-executor.js
lib/clock/job-context-builder.js
lib/doc-pipeline-worker.js
```

职责：

- `clock-core.js`
  - 提供统一的触发入口与基础调度循环
- `job-executor.js`
  - 抽取 overlap / timeout / cooldown / retry 的公共执行逻辑
- `job-context-builder.js`
  - 为 `internal_job` / `app_tick` 提供统一上下文构造接口
- `doc-pipeline-worker.js`
  - 从历史 `doc-ocr-pipeline` app tick 抽出核心执行入口，作为第一个 internal job 样板

##### 本轮复用对象

本轮建议明确复用以下现有对象，不重复建设：

- `DocumentOcrService`
- `DocumentCleanService`
- `DocumentOutlineService`
- `DocumentChunkService`
- `DocumentEmbeddingService`
- `DocPipelineAdvancer`
- `app_tick_log`
- `app_tick_run`

说明：

- 本轮不要求引入新的 `job_run` / `job_log` 表
- 先复用现有日志能力完成最小闭环

##### 本轮替换点

本轮只替换一个关键调度入口：

```text
旧：AppClock -> doc-ocr-pipeline app tick
新：Clock Core -> internal_job(doc-pipeline-worker)
```

需要落地的具体替换：

1. 保留历史 `doc-ocr-pipeline` app tick 的核心业务逻辑可迁移复用
2. 将其核心执行函数抽到 `lib/doc-pipeline-worker.js`
3. 由统一 `Clock Core` 直接调 `doc-pipeline-worker`
4. `AppClock` 不再承担 `doc-ocr-pipeline` 的运行入口

##### 本轮暂不做

为了控制风险，本轮明确**不做**以下事项：

1. 不迁移其他 app tick
2. 不合并 `BackgroundTaskScheduler` 与 `AppClock` 的全部公开接口
3. 不新增 `job_registry` 持久化表
4. 不新增 `job_run` / `job_log` 持久化表
5. 不重写文档处理相关业务 service
6. 不处理 UI 层统一任务管理面板

##### 本轮交付标准

完成本轮后，应满足：

1. `doc-ocr-pipeline` 不再依赖 `mini_apps` / `app_clock_registry` 语义才可运行
2. 文档平台在 `pending_ocr`、`ocr_processing`、`pending_clean`、`pending_outline`、`pending_chunk` 阶段的自动推进不回归
3. 统一执行器的 overlap / timeout / cooldown 逻辑对 internal job 已可复用
4. 后续 internal job / app tick 的统一迁移具备首个样板

### Phase 2：迁移 `doc-ocr-pipeline`

目标：

- 将 `doc-ocr-pipeline` 从 app 语义收回平台内部 worker

动作：

1. 提取其 tick 核心执行函数到内部模块
2. 由统一 clock 以 `internal_job` 调度
3. 保持现有 OCR/清洗/大纲/分块/向量化 service 不变

### Phase 3：迁移所有 internal jobs

对象：

- `doc-pipeline-worker`
- `document-embedding-worker`
- `topic-archiver`
- `autonomous-task-executor`

### Phase 4：迁移 app ticks

对象：

- `ocr-tool`
- `contract-mgr`
- `contract-mgr-v2`
- `invoice-mgr`

最终结果：

- 统一 clock
- 两类 job
- 无错误 app 化的内部流水线

---

## 8.1 Phase 1 完成后的进入条件

只有当以下条件满足时，才建议进入后续更大范围的统一：

1. `doc-pipeline-worker` 已稳定替代 `doc-ocr-pipeline` app tick
2. `app_tick_log` / `app_tick_run` 复用方案已验证可满足过渡期排障需要
3. 文档平台自动状态推进已连续验证不回归
4. 团队已接受 `internal_job` / `app_tick` 双模型

否则不建议过早推进全平台调度统一。

---

## 9. Phase 1 样板任务

当前建议将以下专项作为 Unified Clock 的第一个迁移样板：

- `docs/tasks/active/task-20260703-doc-ocr-pipeline-boundary-realignment/`

该专项不是整个统一 Clock 计划本身，而是：

- **Unified Clock 的首个边界纠偏样板任务**

---

## 10. 验收原则

Unified Clock 迁移必须满足：

1. 平台内部状态机推进不再依赖 `mini_apps` 业务 app 语义
2. 文档平台自动推进不回归
3. internal job 与 app tick 的边界清晰可见
4. 日志与运行状态可统一查询
5. 平台总纲文档与任务专项文档口径一致

---

## 一句话总结

统一 Clock 的最终目标不是“再造第三套调度器”，而是：

- **用一个 Clock Core，统一调度 internal_job 与 app_tick；并把 `doc-ocr-pipeline` 这样的内部流水线从错误的 app 语义中收回来。**
