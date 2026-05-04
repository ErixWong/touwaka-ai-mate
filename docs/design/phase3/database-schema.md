# App 平台数据库设计

> 本文件从 [`app-platform-design.md`](app-platform-design.md) 中提取，集中管理所有数据库表定义。
> 主文档中的数据库章节引用本文件。

## 表总览

| 表名 | 用途 | 所在章节 |
|------|------|----------|
| `mini_apps` | 小程序注册表（多维表格定义） | 核心表 |
| `mini_app_rows` | 小程序数据记录（多维表格行） | 核心表 |
| `mini_app_files` | 小程序文件关联表（关联 attachments） | 核心表 |
| `app_state` | App 状态定义表（状态流转 + 脚本绑定） | 状态机 |
| `app_row_handlers` | 处理脚本表（可被状态机和事件驱动共用） | 状态机 |
| `app_action_logs` | 脚本执行日志 | 状态机 |
| `app_event_handlers` | CRUD 事件处理器表（create/update/delete） | 事件驱动 |
| `mini_app_role_access` | App 角色访问控制 | 权限 |

> **批量进度追踪**：通过查询 `mini_app_rows` 按 `_status` 分组统计实现，无需单独的批量任务表。

---

## 核心表

### mini_apps — 小程序注册表

> 对应 APITable 的 `datasheet` 表。一个 App = 一张多维表格。

```sql
CREATE TABLE mini_apps (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL COMMENT '小程序/表名称',
    description TEXT COMMENT '描述',
    icon VARCHAR(16) DEFAULT '📱' COMMENT '图标（emoji）',
  
    -- 小程序类型
    type ENUM('document', 'workflow', 'data', 'utility') NOT NULL COMMENT '类型',
  
    -- 前端组件标识（动态加载，NULL=使用通用组件）
    component VARCHAR(128) COMMENT '前端组件名，如 ContractManager。NULL 则使用 GenericMiniApp',
  
    -- 字段定义（JSON，核心！对应 APITable 的 datasheet_meta.meta_data）
    -- 定义这张"多维表格"有哪些列
    fields JSON NOT NULL COMMENT '字段定义列表',
    -- 示例：
    -- [
    --   { "name": "contract_number", "label": "合同编号", "type": "text",
    --     "required": true, "ai_extractable": true },
    --   { "name": "contract_date", "label": "签订日期", "type": "date",
    --     "required": true, "ai_extractable": true },
    --   { "name": "contract_amount", "label": "合同金额", "type": "number",
    --     "required": true, "ai_extractable": true },
    --   { "name": "status", "label": "状态", "type": "select",
    --     "options": ["待审批", "执行中", "已完成", "已终止"], "default": "待审批" }
    -- ]
  
    -- 注意：状态定义已移到独立的 app_state 表，不再使用 JSON 存储
    -- 这样状态可查询、流转顺序直观、时钟扫描更高效
  
    -- 视图配置（JSON，定义列表/表单/统计等视图的展示方式）
    views JSON COMMENT '视图配置',
    -- 示例：
    -- {
    --   "list": { "columns": ["contract_number", "contract_date", "party_a", "status"],
    --             "sort": { "field": "contract_date", "order": "desc" },
    --             "filter": {} },
    --   "form": { "layout": "vertical" },
    --   "stats": { "charts": [...] }
    -- }
  
    -- 功能配置（JSON，仅功能开关，不含 AI 管线）
    config JSON COMMENT '功能配置',
    -- 示例：
    -- {
    --   "features": ["upload", "list", "detail", "stats"],
    --   "supported_formats": [".pdf", ".docx", ".jpg"],
    --   "max_file_size": 10485760,
    --   "batch_enabled": true
    -- }
  
    -- 注意：技能和 MCP 服务的调用在处理脚本内部实现
    -- App 配置不需要知道具体用了哪些技能/MCP 服务
  
    -- 权限控制（详见"权限设计"章节，使用 visibility + mini_app_role_access 模型）
    visibility ENUM('owner', 'department', 'all', 'role') DEFAULT 'all'
      COMMENT '可见范围：owner=仅管理员, department=部门可见, all=全员, role=指定角色',
    owner_id VARCHAR(32) NOT NULL COMMENT 'App管理员',
    creator_id VARCHAR(32) NOT NULL COMMENT '创建者',
  
    -- 排序和状态
    sort_order INT DEFAULT 0 COMMENT '排序',
    is_active BIT(1) DEFAULT 1 COMMENT '是否启用',
  
    -- 版本（字段定义变更时递增）
    revision INT DEFAULT 1 COMMENT '版本号',
  
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
    -- 注意：不设 skill_id 外键，技能调用在脚本内部通过 services.callSkill() 实现
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小程序注册表（多维表格定义）';
```

### mini_app_rows — 小程序数据记录表

> 对应 APITable 的 `datasheet_record` 表。所有小程序的数据统一存储在此表。

```sql
CREATE TABLE mini_app_rows (
    id VARCHAR(32) PRIMARY KEY,
    app_id VARCHAR(32) NOT NULL COMMENT '小程序ID（对应哪张表）',
    user_id VARCHAR(32) NOT NULL COMMENT '创建用户ID',
  
    -- 行数据（JSON，核心！对应 APITable 的 datasheet_record.data）
    -- key 是 fields 中定义的 name，value 是字段值
    -- 状态存储在 data._status 字段中（约定字段名）
    data JSON NOT NULL COMMENT '行数据（字段名→值的映射）',
    -- 示例：
    -- {
    --   "_status": "pending_ocr",           -- 系统约定字段，用于时钟扫描
    --   "contract_number": "HT-2024-001",
    --   "contract_date": "2024-03-15",
    --   "party_a": "某某科技有限公司",
    --   "party_b": "某某集团有限公司",
    --   "contract_amount": 100000,
    --   "start_date": "2024-04-01",
    --   "end_date": "2025-03-31",
    --   "business_status": "执行中"        -- 用户自定义业务状态字段
    -- }
  
    -- 记录标题（从 data 中自动提取，用于列表展示）
    title VARCHAR(255) COMMENT '记录标题（冗余，便于列表展示）',
  
    -- AI 处理信息
    ai_extracted BIT(1) DEFAULT 0 COMMENT '是否由AI提取',
    ai_confidence JSON COMMENT '各字段的AI置信度',
    -- 示例：{ "contract_number": 0.98, "contract_amount": 0.85 }
  
    -- 版本管理（用于文档对比场景 C）
    version VARCHAR(32) COMMENT '版本号',
    previous_version_id VARCHAR(32) COMMENT '上一版本ID',
  
    -- 版本号（对应 mini_apps.revision，用于乐观锁）
    revision INT DEFAULT 1 COMMENT '数据版本号',
  
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
    INDEX idx_app_user (app_id, user_id),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (app_id) REFERENCES mini_apps(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小程序数据记录（多维表格行）';

-- 虚拟列索引：为 _status 字段创建索引，便于时钟扫描
ALTER TABLE mini_app_rows
ADD COLUMN _status VARCHAR(64)
  GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$._status'))) STORED,
ADD INDEX idx_app_status (app_id, _status);
```

### mini_app_files — 小程序文件关联表

> 关联 attachments 表，不存储 OCR 结果（OCR 结果存储在 mini_app_rows.data 中）。
> 文件存储复用现有 attachment 服务。

```sql
CREATE TABLE mini_app_files (
    id VARCHAR(32) PRIMARY KEY,
    record_id VARCHAR(32) NOT NULL COMMENT '关联记录ID',
    app_id VARCHAR(32) NOT NULL COMMENT '小程序ID（冗余，便于查询）',
  
    -- 关联 attachments 表
    attachment_id VARCHAR(20) NOT NULL COMMENT '附件ID（关联 attachments 表）',
  
    -- 文件在记录中的字段名（对应 fields 中的 type=file 字段）
    field_name VARCHAR(64) COMMENT '对应的字段名',
  
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
    INDEX idx_app (app_id),
    INDEX idx_attachment (attachment_id),
    FOREIGN KEY (record_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE,
    FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小程序文件关联表';
```

**设计说明**：

| 字段 | 用途 |
|------|------|
| `attachment_id` | 关联 attachments 表，复用现有文件存储服务 |
| `field_name` | 标识文件属于哪个字段（如 `contract_file`） |
| OCR 结果 | 存储在 `mini_app_rows.data` 的 `_ocr_text` 字段中 |

**OCR 结果存储位置**：

```jsonc
// mini_app_rows.data 示例
{
  "_status": "pending_extract",
  "_ocr_text": "合同编号：HT-2024-001\n签订日期：2024年3月15日...",  // OCR 结果
  "_ocr_service": "markitdown",  // OCR 服务标识
  "_ocr_status": "completed",    // OCR 状态
  "contract_number": null,       // 待提取字段
  "contract_date": null
}
```

**优点**：
- attachments 表保持纯粹，不扩展业务字段
- OCR 结果与记录数据紧密关联，便于脚本处理
- 复用现有 attachment 服务的存储、访问、Token 机制

---

## 状态机表

### app_state — App 状态定义表

> 统一管理 App 的状态定义、流转顺序和脚本绑定。
> 替代原来的 `mini_apps.statuses` JSON + `app_state_events` 表的设计。

```sql
CREATE TABLE app_state (
    id VARCHAR(32) PRIMARY KEY,
    app_id VARCHAR(32) NOT NULL COMMENT '小程序ID',
    
    -- 状态定义
    name VARCHAR(64) NOT NULL COMMENT '状态名（如 pending_ocr）',
    label VARCHAR(128) NOT NULL COMMENT '显示名（如 待OCR）',
    sort_order INT DEFAULT 0 COMMENT '流转顺序（0=初始，1=第一步...）',
    
    -- 状态类型
    is_initial BIT(1) DEFAULT 0 COMMENT '是否初始状态',
    is_terminal BIT(1) DEFAULT 0 COMMENT '是否终态',
    is_error BIT(1) DEFAULT 0 COMMENT '是否错误状态',
    
    -- 脚本绑定（一个状态绑定一个脚本）
    handler_id VARCHAR(32) COMMENT '处理脚本ID',
    success_next_state VARCHAR(64) COMMENT '成功后转到什么状态',
    failure_next_state VARCHAR(64) COMMENT '失败后转到什么状态',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_app_name (app_id, name),
    INDEX idx_app_sort (app_id, sort_order),
    FOREIGN KEY (app_id) REFERENCES mini_apps(id) ON DELETE CASCADE,
    FOREIGN KEY (handler_id) REFERENCES app_row_handlers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='App 状态定义表';
```

**设计说明**：

| 字段 | 用途 |
|------|------|
| `sort_order` | 状态流转顺序，0=初始状态，数值越大越靠后 |
| `is_initial` | 标记初始状态，创建记录时自动设置此状态 |
| `is_terminal` | 标记终态，终态不会触发任何脚本 |
| `is_error` | 标记错误状态，用于展示失败记录 |
| `handler_id` | 绑定的处理脚本，NULL 表示无自动处理 |
| `success_next_state` | 脚本成功后转到什么状态 |
| `failure_next_state` | 脚本失败后转到什么状态 |

**示例数据**：

```sql
-- 合同管理 App 的状态定义
INSERT INTO app_state (id, app_id, name, label, sort_order, is_initial, is_terminal, is_error, handler_id, success_next_state, failure_next_state) VALUES
('state-1', 'contract-mgr', 'pending_ocr', '待OCR', 0, 1, 0, 0, 'handler-ocr', 'pending_extract', 'ocr_failed'),
('state-2', 'contract-mgr', 'pending_extract', '待提取', 1, 0, 0, 0, 'handler-extract', 'pending_review', 'extract_failed'),
('state-3', 'contract-mgr', 'pending_review', '待确认', 2, 0, 0, 0, NULL, NULL, NULL),
('state-4', 'contract-mgr', 'confirmed', '已确认', 3, 0, 1, 0, NULL, NULL, NULL),
('state-5', 'contract-mgr', 'ocr_failed', 'OCR失败', 99, 0, 0, 1, NULL, NULL, NULL),
('state-6', 'contract-mgr', 'extract_failed', '提取失败', 99, 0, 0, 1, NULL, NULL, NULL);
```

**时钟扫描方式**：

```sql
-- 查询某 App 的初始状态（用于创建新记录）
SELECT name FROM app_state WHERE app_id = 'contract-mgr' AND is_initial = 1;

-- 查询待处理的状态（有绑定脚本的）
SELECT * FROM app_state 
WHERE app_id = 'contract-mgr' AND handler_id IS NOT NULL;

-- 查询状态流转顺序
SELECT name, label, sort_order, success_next_state, failure_next_state
FROM app_state WHERE app_id = 'contract-mgr' ORDER BY sort_order;
```

### app_row_handlers — 处理脚本表

> 脚本是独立于 App 的处理单元，可以被多个 App 复用。
> 脚本内部实现对 AI 能力的调用（MCP/LLM/技能）。

```sql
CREATE TABLE app_row_handlers (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL COMMENT '脚本名称',
    description TEXT COMMENT '描述',

    -- 脚本入口
    handler VARCHAR(255) NOT NULL COMMENT '处理函数路径，如 "scripts/ocr-service" 或 "skills/fapiao"',
    handler_function VARCHAR(128) DEFAULT 'process' COMMENT '处理函数名，默认 process',

    -- 并发控制
    concurrency INT DEFAULT 3 COMMENT '最大并发数',
    timeout INT DEFAULT 60 COMMENT '超时时间（秒）',
    max_retries INT DEFAULT 2 COMMENT '最大重试次数',

    -- 是否启用
    is_active BIT(1) DEFAULT 1,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='App 行处理器';
```

### app_action_logs — 脚本执行日志

> 记录每次脚本执行的输入、输出、耗时、错误信息。

```sql
CREATE TABLE app_action_logs (
    id VARCHAR(32) PRIMARY KEY,
    handler_id VARCHAR(32) NOT NULL COMMENT '处理器ID',
    record_id VARCHAR(32) NOT NULL COMMENT '行ID',
    app_id VARCHAR(32) NOT NULL COMMENT '小程序ID',

    trigger_status VARCHAR(64) NOT NULL COMMENT '触发时的状态',
    result_status VARCHAR(64) COMMENT '执行后的状态',

    -- 执行结果
    success BIT(1) NOT NULL COMMENT '是否成功',
    output_data JSON COMMENT '处理器输出的数据（填充到 row.data 的内容）',
    error_message TEXT COMMENT '错误信息',

    -- 性能指标
    duration INT COMMENT '执行耗时（毫秒）',
    retry_count INT DEFAULT 0 COMMENT '重试次数',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_handler (handler_id),
    INDEX idx_record (record_id),
    INDEX idx_app_created (app_id, created_at),
    FOREIGN KEY (handler_id) REFERENCES app_row_handlers(id) ON DELETE CASCADE,
    FOREIGN KEY (record_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE,
    FOREIGN KEY (app_id) REFERENCES mini_apps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='App 动作日志';
```

---

## 权限表

### mini_app_role_access — App 角色访问控制

> 当 `mini_apps.visibility = 'role'` 时使用。

```sql
CREATE TABLE mini_app_role_access (
    id VARCHAR(32) PRIMARY KEY,
    app_id VARCHAR(32) NOT NULL COMMENT '小程序ID',
    role_id INT NOT NULL COMMENT '角色ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
    UNIQUE KEY uk_app_role (app_id, role_id),
    FOREIGN KEY (app_id) REFERENCES mini_apps(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小程序角色访问控制';
```

---

## 事件处理器表

### app_event_handlers — CRUD 事件处理器表

> 用于事件驱动模式：固定的 CRUD 事件（create/update/delete）触发脚本执行。
> 与状态驱动模式（业务状态流转）并存，两者可协调工作。

```sql
CREATE TABLE app_event_handlers (
    id VARCHAR(32) PRIMARY KEY,
    app_id VARCHAR(32) NOT NULL COMMENT '小程序ID',
    
    -- 事件类型（固定三种）
    event_type ENUM('create', 'update', 'delete') NOT NULL COMMENT '事件类型',
    
    -- 处理脚本
    handler_id VARCHAR(32) NOT NULL COMMENT '处理脚本ID',
    
    -- 执行控制
    priority INT DEFAULT 0 COMMENT '执行优先级（数值越小越先执行）',
    execution_mode ENUM('sync', 'async') DEFAULT 'sync' COMMENT '执行模式：sync=同步阻塞，async=异步',
    
    -- 失败处理策略
    failure_policy ENUM('block', 'log', 'ignore') DEFAULT 'log' COMMENT '失败策略：block=阻止操作，log=记录日志继续，ignore=忽略继续',
    
    -- 条件过滤（可选）
    condition JSON COMMENT '触发条件，如 {"amount": {"$gt": 10000}}',
    
    is_active BIT(1) DEFAULT 1 COMMENT '是否启用',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_app_event_handler (app_id, event_type, handler_id),
    INDEX idx_app_event (app_id, event_type),
    FOREIGN KEY (app_id) REFERENCES mini_apps(id) ON DELETE CASCADE,
    FOREIGN KEY (handler_id) REFERENCES app_row_handlers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='App CRUD 事件处理器';
```

**设计说明**：

| 字段 | 用途 |
|------|------|
| `event_type` | 固定三种：create（创建后）、update（更新后）、delete（删除前） |
| `priority` | 同一事件可绑定多个脚本，按优先级顺序执行 |
| `execution_mode` | sync=阻塞 API 响应，async=后台执行不阻塞 |
| `failure_policy` | block=阻止操作返回错误，log=记录日志继续，ignore=忽略错误 |
| `condition` | JSON 条件表达式，满足条件才触发 |

**事件类型详解**：

| 事件类型 | 触发时机 | 执行顺序 | 可阻止操作 | 典型用途 |
|---------|---------|---------|-----------|---------|
| `create` | 记录创建后，API 返回前 | 按优先级顺序 | ✅ 可以 | 自动编号、数据校验、通知发送 |
| `update` | 记录更新后，API 返回前 | 按优先级顺序 | ✅ 可以 | 关联更新、审计日志、状态检查 |
| `delete` | 记录删除前，执行检查 | 按优先级顺序 | ✅ 可以 | 权限检查、关联数据检查、资源清理 |

**失败策略详解**：

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| `block` | 阻止操作，返回错误给用户 | 数据校验失败、权限检查失败 |
| `log` | 记录日志，继续执行操作 | 通知发送失败、非关键检查失败 |
| `ignore` | 忽略错误，继续执行 | 可选增强功能失败 |

**条件过滤语法**：

`condition` 字段支持 JSON 条件表达式，用于限定触发条件：

```jsonc
// 示例条件
{ "amount": { "$gt": 10000 } }                    // 金额 > 10000 时触发
{ "status": "draft" }                              // 状态为草稿时触发
{ "$or": [{ "amount": { "$gt": 10000 } }, { "type": "important" }] }  // 或条件

// 支持的操作符
$eq   → 等于
$ne   → 不等于
$gt   → 大于
$gte  → 大于等于
$lt   → 小于
$lte  → 小于等于
$in   → 在列表中
$nin  → 不在列表中
$or   → 或条件
$and  → 且条件
```

**示例数据**：

```sql
-- 合同管理 App 的事件处理器
INSERT INTO app_event_handlers (id, app_id, event_type, handler_id, priority, execution_mode, failure_policy, condition) VALUES
('eh-1', 'contract-mgr', 'create', 'handler-auto-number', 1, 'sync', 'block', NULL),  -- 创建后自动编号，失败阻止
('eh-2', 'contract-mgr', 'create', 'handler-validate', 2, 'sync', 'block', NULL),     -- 创建后数据校验，失败阻止
('eh-3', 'contract-mgr', 'update', 'handler-notification', 1, 'sync', 'log', '{"status": {"$ne": "draft"}}'),  -- 状态变更时发送通知，失败不阻止
('eh-4', 'contract-mgr', 'delete', 'handler-check-relations', 1, 'sync', 'block', NULL);  -- 删除前检查关联数据，有关联则阻止
```

**执行流程**：

```
用户操作：POST /api/mini-apps/:appId/data
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. 查询 app_event_handlers                                      │
│     WHERE app_id = ? AND event_type = 'create' AND is_active = 1 │
│     ORDER BY priority ASC                                        │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. 检查 condition 条件                                          │
│     对每个 handler，检查 condition 是否满足                      │
│     不满足则跳过该 handler                                       │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. 执行脚本（按 priority 顺序）                                  │
│     for each handler:                                            │
│       a. 加载脚本 handler                                         │
│       b. 调用 process(context)                                    │
│       c. 根据结果：                                               │
│          success → 合并 data 到记录                               │
│          failure + block → 返回错误，阻止操作                      │
│          failure + log → 记录日志，继续                           │
│          failure + ignore → 忽略，继续                            │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 所有脚本执行完毕                                              │
│     • 无阻止 → 创建记录，返回成功                                  │
│     • 有阻止 → 返回错误，不创建记录                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 批量进度查询

> **设计决策**：不使用单独的批量任务表，进度信息通过查询 `mini_app_rows` 按 `_status` 分组统计实现。

### 进度查询 SQL

```sql
-- 查询某用户在某 App 下、某时间范围内的记录状态分布
SELECT _status, COUNT(*) as count
FROM mini_app_rows
WHERE app_id = 'contract-mgr'
  AND user_id = 'user_123'
  AND created_at >= '2026-04-14 10:00:00'  -- 批量上传开始时间
GROUP BY _status;

-- 结果示例：
-- pending_ocr: 5
-- pending_extract: 8
-- pending_review: 20
-- confirmed: 15
-- ocr_failed: 2
```

### 前端进度计算

```javascript
// 从状态分布计算进度
const statusCounts = await fetch(`/api/mini-apps/${appId}/status-summary?created_after=${uploadTime}`);

const total = statusCounts.reduce((sum, s) => sum + s.count, 0);
const completed = statusCounts.find(s => s._status === 'confirmed')?.count || 0;
const failed = statusCounts.filter(s => s._status.endsWith('_failed')).reduce((sum, s) => sum + s.count, 0);
const pending = total - completed - failed;

// 前端展示进度条
const progress = {
  total,
  completed,
  failed,
  pending,
  percentage: Math.round((completed + failed) / total * 100)
};
```

### 设计理由

| 理由 | 说明 |
|------|------|
| **业务字段更重要** | 用户真正关心的是项目、产品、客户等业务字段，而非批次号 |
| **时间戳足够** | 用 `created_at` 时间范围查询即可区分"这次上传"和"上次上传" |
| **减少冗余** | 进度信息可从 `mini_app_rows` 直接查询，无需单独表 |
| **架构简化** | 减少一张表，减少维护成本 |

---

## 知识库扩展（kb_articles）

> 场景 C（质量文档管理）需要扩展知识库表。**需 Eric 确认后执行。**

```sql
-- kb_articles 表扩展字段
ALTER TABLE kb_articles 
ADD COLUMN source_type VARCHAR(32) DEFAULT 'manual' 
  COMMENT '来源类型：manual=手动创建, app_sync=App同步',
ADD COLUMN source_app_id VARCHAR(32) COMMENT '来源小程序ID',
ADD COLUMN source_record_id VARCHAR(32) COMMENT '来源记录ID',
ADD COLUMN effective_date DATE COMMENT '生效日期',
ADD COLUMN expiry_date DATE COMMENT '失效日期',
ADD COLUMN version VARCHAR(32) COMMENT '版本号',
ADD COLUMN document_status ENUM('draft', 'effective', 'expired', 'superseded') 
  DEFAULT 'effective' COMMENT '文档状态';
```

---

## 虚拟列索引（按需优化）

> 初期不建虚拟列，纯 JSON 查询。当某个小程序数据量超过 1000 条且查询变慢时，再按需添加。

```sql
-- 示例：为"合同管理"小程序的合同编号创建虚拟列
ALTER TABLE mini_app_rows
ADD COLUMN contract_number VARCHAR(64)
  GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.contract_number'))) STORED,
ADD INDEX idx_contract_number (contract_number);

-- 为发票号码创建虚拟列
ALTER TABLE mini_app_rows
ADD COLUMN invoice_number VARCHAR(64)
  GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.invoice_number'))) STORED,
ADD INDEX idx_invoice_number (invoice_number);
```

---

## ER 关系图

```
mini_apps (1) ──< mini_app_rows (N)
    │                    │
    │                    ├──< mini_app_files (N) ──> attachments (1)
    │                    │                              │
    │                    │                              └── [source_tag='mini_app_file']
    │                    │
    │                    └── [data._status] ──> app_state.name  [逻辑关联]
    │                    └── [data._ocr_text]  [OCR 结果存储在 data 中]
    │
    ├──< mini_app_role_access (N)  [visibility='role' 时]
    │
    ├──< app_state (N) ──> app_row_handlers (1)  [状态驱动]
    │       │
    │       └── [success_next_state/failure_next_state] ──> app_state.name  [自引用]
    │
    └──< app_event_handlers (N) ──> app_row_handlers (1)  [事件驱动]
            │
            └── [event_type: create/update/delete]  [固定三种事件]

app_row_handlers (1) ──< app_action_logs (N)  [状态驱动执行日志]
app_row_handlers (1) ──< app_event_handlers (N)  [事件驱动复用脚本]

mini_app_rows.previous_version_id ──> mini_app_rows.id  [版本链，自引用]
mini_app_rows.user_id ──> users.id
mini_app_role_access.role_id ──> roles.id
mini_app_files.attachment_id ──> attachments.id  [复用现有附件服务]
```

**关键变化**：

1. **删除 `mini_apps.statuses` JSON 字段** — 状态定义移到 `app_state` 表
2. **删除 `mini_app_rows.status` 独立字段** — 状态存入 `data._status` JSON 字段
3. **删除 `app_state_events` 表** — 状态→脚本绑定整合到 `app_state` 表
4. **删除 `batch_tasks` 表** — 批量进度通过 `mini_app_rows` 状态统计实现
5. **新增 `app_state` 表** — 统一管理状态定义、流转顺序、脚本绑定
6. **新增 `app_event_handlers` 表** — 管理 CRUD 事件处理器（create/update/delete）
7. **mini_app_files 改为关联表** — 关联 attachments 表，OCR 结果存入 `mini_app_rows.data`
8. **两种驱动模式并存** — 状态驱动（业务流转）+ 事件驱动（CRUD 操作）
