# 组织架构设计

> 版本：1.0  
> 最后更新：2026-03-01

---

## 核心思想

### 职位与专家分离

传统设计将"角色"和"具体执行者"混为一谈。新设计将两者分离：

```
┌─────────────────────────────────────────────────────────────┐
│ 组织架构（固定）                                              │
│                                                              │
│  职位是固定的，定义了职责、权限、工作流程                       │
│  就像公司的组织架构图，部门是固定的，人员可以调动               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 专家配置（可更换）                                            │
│                                                              │
│  每个职位可以配置一个 AI 专家，或未来配置真人                   │
│  就像给职位招聘员工，可以换人，也可以外包                       │
└─────────────────────────────────────────────────────────────┘
```

### 为什么这样设计？

1. **灵活性**：同一个职位可以配置不同的专家，适应不同场景
2. **可扩展**：未来可以接入真人专家，实现人机混合协作
3. **可维护**：组织架构稳定，专家可以独立升级/更换
4. **可追溯**：每个职位的执行记录清晰，便于审计

---

## 当前职位列表

### 职位层级图

```
                    ┌─────────────────┐
                    │   Orchestrator   │
                    │     (总监)       │
                    │                 │
                    │  分配任务        │
                    │  询问结果        │
                    │  拉起专家干活    │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    Analyst      │ │     Worker      │ │    Reviewer     │
│    (分析师)      │ │    (执行者)      │ │    (审核员)     │
│                 │ │                 │ │                 │
│  ANALYSIS 阶段  │ │  PROCESS 阶段   │ │  REVIEW 阶段    │
│  需求分析       │ │  具体执行        │ │  质量审核       │
│  方案设计       │ │  代码开发        │ │  结果验收       │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 职位详细定义

| 职位 ID | 名称 | 类型 | 职责 | 对应阶段 |
|---------|------|------|------|----------|
| `orchestrator` | 总监/调度器 | 内部 | 分配任务、询问结果、调度专家 | 全局 |
| `analyst` | 分析师 | 内部 | 需求分析、方案设计、计划制定 | ANALYSIS |
| `worker` | 执行者 | 内部 | 具体执行、代码开发、数据处理 | PROCESS |
| `reviewer` | 审核员 | 内部 | 质量审核、结果验收、问题反馈 | REVIEW |

### Orchestrator（总监）

```yaml
id: orchestrator
name: 总监/调度器
type: internal  # 内部专家，用户不可见

职责:
  - 扫描活跃 Task，决定需要哪些专家
  - 问询专家状态，读取状态文件
  - 根据状态决策下一步动作
  - 启动新专家，分配任务
  - 回收闲置资源

权限:
  目录:
    readonly:
      - /work/{user_id}/{task_id}/.expert-status.json  # 读取专家状态
      - /work/{user_id}/{task_id}/*.md                  # 读取任务文档
    readwrite: []  # 不需要写权限

模型要求:
  类型: 小模型（本地部署）
  推荐: Qwen-7B, LLaMA-8B
  原因: 
    - 只需理解结构化状态
    - 从有限选项中决策
    - 响应速度快，成本低

决策逻辑:
  规则优先:
    - state=completed → 推进到下一阶段
    - state=waiting_input + type=document → 提供文档
    - state=blocked + type=dependency_missing → 尝试自动安装
    - state=failed → 通知用户
  
  LLM 兜底:
    - 规则无法处理时，调用小模型决策
```

### Analyst（分析师）

```yaml
id: analyst
name: 分析师
type: internal

职责:
  - 分析用户需求
  - 制定执行计划
  - 输出方案文档

权限:
  目录:
    readwrite:
      - /work/{user_id}/{task_id}/01-analysis/  # 分析工作目录
    readonly:
      - /work/{user_id}/{task_id}/00-requirements/  # 需求文档
      - /skills/  # 技能库

模型要求:
  类型: 大模型
  推荐: GPT-4, Claude-3
  原因:
    - 需要深度理解需求
    - 需要创造性思维
```

### Worker（执行者）

```yaml
id: worker
name: 执行者
type: internal

职责:
  - 执行具体任务
  - 代码开发
  - 数据处理

权限:
  目录:
    readwrite:
      - /work/{user_id}/{task_id}/02-process/  # 执行工作目录
    readonly:
      - /work/{user_id}/{task_id}/01-analysis/  # 分析结果
      - /skills/  # 技能库

模型要求:
  类型: 大模型
  推荐: Claude-3, GPT-4
  原因:
    - 需要代码生成能力
    - 需要工具调用能力
```

### Reviewer（审核员）

```yaml
id: reviewer
name: 审核员
type: internal

职责:
  - 审核执行结果
  - 质量检查
  - 输出审核报告

权限:
  目录:
    readwrite:
      - /work/{user_id}/{task_id}/03-review/  # 审核工作目录
    readonly:
      - /work/{user_id}/{task_id}/  # 所有阶段结果
      - /skills/  # 技能库

模型要求:
  类型: 大模型
  推荐: GPT-4
  原因:
    - 需要全面理解
    - 需要批判性思维
```

---

## 专家分身机制

### 为什么需要分身？

当一个 Task 进入某个阶段时，需要创建一个专家实例来执行。这个实例就是"分身"：

```
Task T20260301_001 进入 PROCESS 阶段

1. Orchestrator 决定需要 Worker
2. 从 Worker 职位配置中获取专家模板
3. 创建专家分身：
   - 分身 ID: worker_T20260301_001
   - 继承职位权限
   - 绑定到当前 Task
   - 创建独立沙箱
4. 分身开始执行
5. 执行完成后，分身销毁，沙箱回收
```

### 分身生命周期

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  创建    │────▶│  执行    │────▶│  完成    │────▶│  销毁    │
│          │     │          │     │          │     │          │
│ 继承配置 │     │ 独立沙箱 │     │ 输出结果 │     │ 资源回收 │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                │                │
     │                │                │
     ▼                ▼                ▼
  分配沙箱         定时问询          收集结果
  绑定 Task       状态监控          归档记录
```

---

## 真人专家扩展（预留设计）

### 设计理念

职位不仅可以配置 AI 专家，未来还可以配置真人：

```
┌─────────────────────────────────────────────────────────────┐
│ 职位配置                                                     │
│                                                              │
│  职位: Reviewer                                              │
│  ├── 配置 A: quality-auditor (AI 专家)                       │
│  │   └── 模型: GPT-4                                         │
│  │                                                          │
│  └── 配置 B: senior-developer@company.com (真人)             │
│       └── 通知方式: 邮件                                     │
│       └── 响应超时: 24 小时                                  │
│       └── 回退策略: 自动审核                                 │
└─────────────────────────────────────────────────────────────┘
```

### 真人专家接口

```typescript
interface HumanExpert {
  type: 'human';
  position: string;           // 职位 ID
  contact: {
    email?: string;           // 邮件地址
    webhook?: string;         // Webhook URL
    IM?: string;              // 即时通讯
  };
  timeout: number;            // 响应超时（分钟）
  fallback: 'auto' | 'abort' | 'retry';  // 超时回退策略
}

// 通知真人专家
async function notifyHumanExpert(
  expert: HumanExpert,
  task: Task,
  context: ExpertContext
): Promise<void> {
  const message = buildNotificationMessage(task, context);
  
  if (expert.contact.email) {
    await sendEmail({
      to: expert.contact.email,
      subject: `[Task ${task.id}] 需要您的审核`,
      body: message
    });
  }
  
  // 等待响应或超时
  const response = await waitForResponse(expert.timeout);
  
  if (!response) {
    // 执行回退策略
    await executeFallback(expert.fallback, task);
  }
}
```

### 人机混合协作场景

```
场景：代码审核流程

1. Worker (AI) 完成代码开发
2. Orchestrator 调度 Reviewer
3. Reviewer 配置为真人 (senior-developer@company.com)
4. 系统发送邮件通知
5. 真人审核代码，回复审核结果
6. Orchestrator 收到结果，推进流程

如果 24 小时无响应：
  - 自动审核通过（低风险项目）
  - 或中止任务等待处理（高风险项目）
```

---

## 数据库设计

### 职位定义表

```sql
CREATE TABLE org_positions (
    id VARCHAR(32) PRIMARY KEY COMMENT '职位 ID',
    name VARCHAR(100) NOT NULL COMMENT '职位名称',
    description TEXT COMMENT '职位描述',
    
    -- 类型
    type ENUM('internal', 'user') NOT NULL DEFAULT 'internal' 
        COMMENT 'internal=内部专家, user=用户可见',
    
    -- 对应的 Task 阶段
    phase VARCHAR(20) COMMENT 'ANALYSIS/PROCESS/REVIEW，null 表示全局',
    
    -- 权限模板
    readonly_patterns TEXT COMMENT '只读目录模式 JSON',
    readwrite_patterns TEXT COMMENT '读写目录模式 JSON',
    
    -- 资源限制
    max_memory_mb INT DEFAULT 512 COMMENT '最大内存',
    max_processes INT DEFAULT 50 COMMENT '最大进程数',
    timeout_minutes INT DEFAULT 30 COMMENT '默认超时',
    
    -- 模型建议
    recommended_model_type ENUM('small', 'large') DEFAULT 'large' 
        COMMENT '建议的模型类型',
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) COMMENT '组织架构职位定义';
```

### 职位-专家配置表

```sql
CREATE TABLE org_position_config (
    id VARCHAR(64) PRIMARY KEY,
    position_id VARCHAR(32) NOT NULL COMMENT '职位 ID',
    
    -- 专家配置（二选一）
    expert_id VARCHAR(32) COMMENT 'AI 专家 ID',
    human_contact JSON COMMENT '真人联系方式 {email, webhook, IM}',
    
    -- 模型配置（AI 专家用）
    model_id VARCHAR(64) COMMENT '使用的模型 ID',
    
    -- 真人配置
    human_timeout_minutes INT DEFAULT 1440 COMMENT '真人响应超时（分钟）',
    human_fallback ENUM('auto', 'abort', 'retry') DEFAULT 'abort' COMMENT '超时回退策略',
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (position_id) REFERENCES org_positions(id),
    FOREIGN KEY (expert_id) REFERENCES experts(id)
) COMMENT '职位-专家配置';
```

### 初始数据

```sql
-- 职位定义
INSERT INTO org_positions (id, name, type, phase, recommended_model_type, 
                           readonly_patterns, readwrite_patterns) VALUES
('orchestrator', '总监/调度器', 'internal', NULL, 'small',
 '["/work/{user_id}/{task_id}/.expert-status.json", "/work/{user_id}/{task_id}/*.md"]',
 '[]'),
('analyst', '分析师', 'internal', 'ANALYSIS', 'large',
 '["/work/{user_id}/{task_id}/00-requirements/", "/skills/"]',
 '["/work/{user_id}/{task_id}/01-analysis/"]'),
('worker', '执行者', 'internal', 'PROCESS', 'large',
 '["/work/{user_id}/{task_id}/01-analysis/", "/skills/"]',
 '["/work/{user_id}/{task_id}/02-process/"]'),
('reviewer', '审核员', 'internal', 'REVIEW', 'large',
 '["/work/{user_id}/{task_id}/", "/skills/"]',
 '["/work/{user_id}/{task_id}/03-review/"]');
```

---

## 前端界面设计

### 组织架构配置界面

```
┌─────────────────────────────────────────────────────────────┐
│ 组织架构配置                                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Orchestrator (总监)                           [编辑] │    │
│  │                                                      │    │
│  │ 当前配置: internal-dispatcher (AI)                   │    │
│  │ 模型: Qwen-7B-Local                                 │    │
│  │ 状态: ● 运行中                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Analyst (分析师)                              [编辑] │    │
│  │                                                      │    │
│  │ 当前配置: requirement-analyst (AI)                   │    │
│  │ 模型: GPT-4                                          │    │
│  │ 阶段: ANALYSIS                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Worker (执行者)                               [编辑] │    │
│  │                                                      │    │
│  │ 当前配置: code-developer (AI)                        │    │
│  │ 模型: Claude-3                                       │    │
│  │ 阶段: PROCESS                                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Reviewer (审核员)                             [编辑] │    │
│  │                                                      │    │
│  │ 当前配置: quality-auditor (AI)                       │    │
│  │ 模型: GPT-4                                          │    │
│  │ 阶段: REVIEW                                         │    │
│  │                                                      │    │
│  │ [切换为真人专家]                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 职位编辑弹窗

```
┌─────────────────────────────────────────────────────────────┐
│ 配置 Reviewer 职位                                    [×]   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  专家类型:                                                   │
│  ◉ AI 专家    ○ 真人专家                                    │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  选择 AI 专家:                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ quality-auditor   "质量审核专家，擅长代码审查..."    │    │
│  │ code-reviewer     "代码审核专家，专注于安全漏洞..."  │    │
│  │ general-reviewer  "通用审核专家，适用于各种任务..."  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  选择模型:                                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ GPT-4 (推荐)                                        │    │
│  │ Claude-3                                            │    │
│  │ Qwen-Max                                            │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│                              [取消]  [保存配置]              │
└─────────────────────────────────────────────────────────────┘
```

### 真人专家配置弹窗

```
┌─────────────────────────────────────────────────────────────┐
│ 配置 Reviewer 职位 (真人)                             [×]   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  专家类型:                                                   │
│  ○ AI 专家    ◉ 真人专家                                    │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│                                                              │
│  联系方式:                                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 邮箱: senior-developer@company.com                  │    │
│  │ Webhook: (可选)                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  响应超时: [24] 小时                                         │
│                                                              │
│  超时回退策略:                                               │
│  ◉ 自动审核通过    ○ 中止任务    ○ 等待重试                 │
│                                                              │
│  ⚠️ 注意：真人专家会增加任务执行时间                         │
│                                                              │
│                              [取消]  [保存配置]              │
└─────────────────────────────────────────────────────────────┘
```

---

## 与现有设计的关系

### 相关文档

| 文档 | 关系 |
|------|------|
| [sandbox-architecture.md](sandbox-architecture.md) | 沙箱架构，职位权限在沙箱中体现 |
| [expert-orchestration.md](expert-orchestration.md) | 专家编排，Orchestrator 调度专家分身 |
| [task-layer-design.md](task-layer-design.md) | Task 阶段，职位与阶段对应 |

### 架构层次

```
┌─────────────────────────────────────────────────────────────┐
│ Org Architecture (组织架构)                                  │
│ - 定义职位、职责、权限                                        │
│ - 职位-专家配置                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Expert Orchestration (专家编排)                              │
│ - Orchestrator 调度                                          │
│ - 专家分身创建/销毁                                           │
│ - 状态问询                                                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Sandbox Architecture (沙箱架构)                              │
│ - 沙箱池管理                                                 │
│ - 权限隔离                                                   │
│ - 资源回收                                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 未来扩展

### 更多职位

随着业务发展，可以扩展更多职位：

| 职位 | 职责 | 阶段 |
|------|------|------|
| Planner | 任务拆解、计划制定 | PLANNING |
| Tester | 自动化测试 | TEST |
| Deployer | 部署发布 | DEPLOY |
| Monitor | 运行监控 | MONITOR |

### 团队协作

未来可以支持多用户协作：

```
┌─────────────────────────────────────────────────────────────┐
│ Team Organization                                            │
│                                                              │
│  Team Lead (user_1)                                          │
│  ├── Reviewer: user_1@company.com (真人)                     │
│  └── Workers:                                                │
│      ├── Worker A: code-expert-1 (AI)                        │
│      └── Worker B: code-expert-2 (AI)                        │
└─────────────────────────────────────────────────────────────┘
```

---

*让我们一起构建灵活、可扩展的专家组织架构！ 🏢✨*
