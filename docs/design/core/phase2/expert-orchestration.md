# 专家编排设计

> 创建时间：2026-03-01
> 状态：设计中

---

## 1. 概述

本文档描述 Task 执行过程中，主循环如何调度、问询、管理内部专家的生命周期。

### 1.1 核心问题

Task 进入执行阶段后，需要：
1. 启动内部专家（Analyst / Worker / Reviewer）
2. 持续问询专家状态（工蜂照顾卵模式）
3. 响应专家的输入请求
4. 处理异常情况（阻塞、超时、失败）
5. 回收资源

### 1.2 设计原则

- **主循环负责调度**：不依赖外部触发
- **文件系统通信**：专家通过文件系统与主循环通信
- **状态驱动**：基于状态文件决定下一步动作
- **容错优先**：任何异常都可恢复

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                   TaskOrchestrator                           │
│                      (主循环调度器)                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ tick() 每 10s 执行一次                                  │ │
│  │                                                         │ │
│  │  1. 扫描活跃 Task                                       │ │
│  │     └── 根据 phase 决定需要的专家                       │ │
│  │                                                         │ │
│  │  2. 问询活跃专家                                        │ │
│  │     ├── 读取 .status.json                               │ │
│  │     ├── waiting_input → 提供输入                        │ │
│  │     ├── completed → 收集结果，释放沙箱                  │ │
│  │     ├── blocked → 分析原因，决定对策                     │ │
│  │     └── timeout → 强制终止                              │ │
│  │                                                         │ │
│  │  3. 启动新专家                                          │ │
│  │     └── 从 SandboxPool 获取沙箱 → 启动专家进程          │ │
│  │                                                         │ │
│  │  4. 回收闲置沙箱                                        │ │
│  │     └── 闲置 > 5min → 销毁                              │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
    ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
    │ Analyst 沙箱 │      │ Worker 沙箱  │      │Reviewer 沙箱│
    │             │      │             │      │             │
    │ .status:    │      │ .status:    │      │ .status:    │
    │  running    │      │  waiting    │      │  completed  │
    │  progress:65│      │  need:spec  │      │  result:ok  │
    └─────────────┘      └─────────────┘      └─────────────┘
```

---

## 3. 专家角色定义

### 3.1 角色-阶段映射

| 阶段 | 专家角色 | 职责 | 输入 | 输出 |
|------|----------|------|------|------|
| ANALYSIS | analyst | 需求分析、方案设计 | 00-requirements/ | plan.md, tech_design.md |
| PROCESS | worker | 执行任务 | 01-analysis/plan.md | 02-process/* |
| REVIEW | reviewer | 审核结果 | 02-process/ | 03-review/report.md |
| - | orchestrator | 主循环调度（特殊） | 全局 | - |

### 3.2 专家可见性

| 可见性 | 说明 | 用户可见 | 主循环可见 |
|--------|------|----------|------------|
| `user` | 用户可见专家 | ✓ | ✓ |
| `internal` | 内部专家 | ✗ | ✓ |
| `admin` | 仅管理员 | 仅管理员 | ✓ |

### 3.3 内部专家特点

```
┌─────────────────────────────────────────────────────────────┐
│ 内部专家                                     │
│                                                              │
│ ├── 不响应用户消息                                           │
│ ├── 由主循环调度启动                                         │
│ ├── 输入来源：文件（文档、配置）                              │
│ ├── 输出去向：文件（结果、状态）                              │
│ ├── 生命周期：单次 Task 阶段执行期间                          │
│ └── 沙箱权限：用户权限的子集                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 主循环设计

### 4.1 TaskOrchestrator 核心实现

```javascript
class TaskOrchestrator {
  constructor(options = {}) {
    this.tickInterval = options.tickInterval || 10000;  // 10秒
    this.db = options.db;
    this.sandboxPool = options.sandboxPool;
    this.expertManager = options.expertManager;
    this.running = false;
  }

  /**
   * 启动主循环
   */
  async start() {
    if (this.running) return;
    this.running = true;
    
    this.timer = setInterval(() => this.tick(), this.tickInterval);
    
    // 立即执行一次
    await this.tick();
  }

  /**
   * 停止主循环
   */
  async stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 主循环 tick
   */
  async tick() {
    try {
      // 1. 扫描需要处理的 Task
      const tasks = await this.scanTasks();
      
      // 2. 处理每个 Task
      for (const task of tasks) {
        await this.processTask(task);
      }
      
      // 3. 问询活跃的专家执行
      await this.queryActiveExecutions();
      
      // 4. 回收闲置沙箱
      await this.sandboxPool.reclaimIdle();
      
    } catch (error) {
      console.error('[TaskOrchestrator] tick error:', error);
    }
  }

  /**
   * 扫描需要处理的 Task
   */
  async scanTasks() {
    // 查询状态为 ANALYSIS/PROCESS/REVIEW 的 Task
    // 且当前阶段没有活跃的执行记录
    return this.db.query(`
      SELECT t.* FROM tasks t
      WHERE t.status IN ('ANALYSIS', 'PROCESS', 'REVIEW')
        AND NOT EXISTS (
          SELECT 1 FROM expert_executions ee
          WHERE ee.task_id = t.task_id
            AND ee.status IN ('pending', 'running', 'waiting_input')
        )
    `);
  }

  /**
   * 处理单个 Task
   */
  async processTask(task) {
    const phase = task.status;  // ANALYSIS/PROCESS/REVIEW
    
    // 检查是否需要启动专家
    const activeExec = await this.getActiveExecution(task.task_id);
    
    if (!activeExec) {
      // 启动对应阶段的专家
      await this.startExpertForPhase(task, phase);
    }
  }

  /**
   * 为阶段启动专家
   */
  async startExpertForPhase(task, phase) {
    const expertRole = this.getExpertRoleForPhase(phase);
    const userId = task.created_by;
    const taskId = task.task_id;
    
    // 获取沙箱
    const sandbox = await this.sandboxPool.acquire(userId, expertRole, taskId);
    
    // 创建执行记录
    const execution = await this.db.ExpertExecution.create({
      id: generateId(),
      sandbox_id: sandbox.id,
      task_id: taskId,
      expert_id: this.getExpertIdForRole(expertRole),
      expert_role: expertRole,
      phase: phase,
      status: 'pending',
      timeout_at: new Date(Date.now() + this.getTimeout(expertRole)),
    });
    
    // 准备输入文件
    await this.prepareInputFiles(task, phase);
    
    // 启动专家进程
    await this.launchExpert(sandbox, execution, task);
    
    // 更新执行状态
    await execution.update({ status: 'running', started_at: new Date() });
    
    return execution;
  }

  /**
   * 问询活跃执行
   */
  async queryActiveExecutions() {
    const executions = await this.db.ExpertExecution.findAll({
      where: { status: ['running', 'waiting_input'] }
    });
    
    for (const exec of executions) {
      await this.queryExecution(exec);
    }
  }

  /**
   * 问询单个执行
   */
  async queryExecution(execution) {
    // 检查超时
    if (execution.timeout_at && new Date() > execution.timeout_at) {
      await this.handleTimeout(execution);
      return;
    }
    
    // 读取状态文件
    const status = await this.readStatusFile(execution.task_id);
    
    if (!status) {
      // 状态文件不存在，检查进程是否存活
      const alive = await this.checkProcessAlive(execution.sandbox_id);
      if (!alive) {
        await this.handleCrash(execution);
      }
      return;
    }
    
    // 根据状态处理
    switch (status.state) {
      case 'running':
        // 正在运行，更新进度
        await execution.update({
          progress: status.progress,
          message: status.message,
        });
        break;
        
      case 'waiting_input':
        // 等待输入，提供所需内容
        await this.provideInput(execution, status.waiting_for);
        break;
        
      case 'completed':
        // 完成，收集结果
        await this.handleCompleted(execution, status);
        break;
        
      case 'blocked':
        // 阻塞，分析原因
        await this.handleBlocked(execution, status);
        break;
        
      case 'failed':
        // 失败，记录错误
        await this.handleFailed(execution, status);
        break;
    }
  }

  /**
   * 读取专家状态文件
   */
  async readStatusFile(taskId) {
    const statusPath = path.join(WORK_ROOT, taskId, '.expert-status.json');
    
    try {
      const content = await fs.readFile(statusPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * 提供输入
   */
  async provideInput(execution, waitingFor) {
    const task = await this.db.Task.findByPk(execution.task_id);
    
    // 根据等待类型提供不同的输入
    switch (waitingFor.type) {
      case 'document':
        // 复制文档到工作目录
        const docPath = path.join(WORK_ROOT, task.task_id, waitingFor.path);
        await this.copyDocument(task, waitingFor.documentId, docPath);
        break;
        
      case 'approval':
        // 需要用户确认，通知用户
        await this.notifyUser(task.created_by, {
          type: 'approval_required',
          taskId: task.task_id,
          message: waitingFor.message,
        });
        break;
        
      case 'clarification':
        // 需要澄清，转给用户
        await this.transferToUser(task, waitingFor.question);
        break;
    }
    
    // 写入确认文件
    await this.writeInputConfirmation(execution.task_id, waitingFor);
  }

  /**
   * 处理完成
   */
  async handleCompleted(execution, status) {
    const task = await this.db.Task.findByPk(execution.task_id);
    
    // 更新执行记录
    await execution.update({
      status: 'completed',
      progress: 1,
      completed_at: new Date(),
    });
    
    // 释放沙箱
    await this.sandboxPool.release(execution.sandbox_id);
    
    // 推进到下一阶段
    await this.advancePhase(task);
  }

  /**
   * 处理阻塞
   */
  async handleBlocked(execution, status) {
    await execution.update({
      status: 'blocked',
      block_reason: status.block_reason,
    });
    
    const task = await this.db.Task.findByPk(execution.task_id);
    
    // 分析阻塞原因
    if (status.block_reason.type === 'dependency_missing') {
      // 尝试自动解决
      const resolved = await this.tryResolveDependency(status.block_reason);
      if (resolved) {
        // 重新启动
        await execution.update({ status: 'pending' });
        return;
      }
    }
    
    // 无法自动解决，通知用户
    await this.notifyUser(task.created_by, {
      type: 'task_blocked',
      taskId: task.task_id,
      reason: status.block_reason,
    });
  }

  /**
   * 处理失败
   */
  async handleFailed(execution, status) {
    await execution.update({
      status: 'failed',
      error_message: status.error,
      completed_at: new Date(),
    });
    
    // 释放沙箱
    await this.sandboxPool.release(execution.sandbox_id);
    
    const task = await this.db.Task.findByPk(execution.task_id);
    
    // 更新任务状态
    await task.update({ status: 'FAILED' });
    
    // 通知用户
    await this.notifyUser(task.created_by, {
      type: 'task_failed',
      taskId: task.task_id,
      error: status.error,
    });
  }

  /**
   * 处理超时
   */
  async handleTimeout(execution) {
    await execution.update({
      status: 'timeout',
      error_message: 'Execution timeout',
    });
    
    // 强制终止沙箱进程
    await this.sandboxPool.destroy(execution.sandbox_id);
    
    // 根据策略决定是否重试
    // ...
  }

  /**
   * 推进阶段
   */
  async advancePhase(task) {
    const phaseOrder = ['ANALYSIS', 'PROCESS', 'REVIEW', 'DONE'];
    const currentIndex = phaseOrder.indexOf(task.status);
    
    if (currentIndex < phaseOrder.length - 1) {
      const nextPhase = phaseOrder[currentIndex + 1];
      await task.update({ status: nextPhase });
      
      if (nextPhase === 'DONE') {
        await this.finalizeTask(task);
      }
    }
  }
}
```

---

## 5. 专家-主循环通信协议

### 5.1 状态文件格式

专家在沙箱内定期写入状态文件：

**路径：** `/work/{userId}/{taskId}/.expert-status.json`

```json
{
  "expert": "worker",
  "phase": "PROCESS",
  "state": "running",
  "progress": 0.65,
  "message": "正在处理数据...",
  "waiting_for": null,
  "block_reason": null,
  "error": null,
  "updated_at": "2026-03-01T10:30:00Z"
}
```

### 5.2 状态定义

| 状态 | 说明 | 主循环动作 |
|------|------|------------|
| `running` | 正在执行 | 更新进度，继续等待 |
| `waiting_input` | 等待输入 | 分析 waiting_for，提供输入 |
| `completed` | 执行完成 | 收集结果，推进阶段 |
| `blocked` | 阻塞 | 分析原因，尝试解决或通知用户 |
| `failed` | 失败 | 记录错误，通知用户 |
| `timeout` | 超时 | 强制终止 |

### 5.3 等待输入类型

```json
{
  "state": "waiting_input",
  "waiting_for": {
    "type": "document",
    "document_id": "spec_v1",
    "path": "02-process/input/spec.pdf",
    "reason": "需要参考规格文档"
  }
}
```

```json
{
  "state": "waiting_input",
  "waiting_for": {
    "type": "approval",
    "message": "检测到高风险操作，需要用户确认",
    "options": ["允许", "跳过", "取消"]
  }
}
```

```json
{
  "state": "waiting_input",
  "waiting_for": {
    "type": "clarification",
    "question": "需求描述中有歧义，请澄清：..."
  }
}
```

### 5.4 阻塞原因类型

```json
{
  "state": "blocked",
  "block_reason": {
    "type": "dependency_missing",
    "name": "numpy",
    "version": ">=1.20"
  }
}
```

```json
{
  "state": "blocked",
  "block_reason": {
    "type": "resource_unavailable",
    "resource": "gpu",
    "message": "GPU 不可用"
  }
}
```

```json
{
  "state": "blocked",
  "block_reason": {
    "type": "external_error",
    "source": "api_call",
    "message": "外部 API 返回错误: 429 Too Many Requests"
  }
}
```

---

## 6. 专家进程实现

### 6.1 专家进程框架

```javascript
// 专家进程入口 (lib/expert-worker.js)
class ExpertWorker {
  constructor(config) {
    this.taskId = config.taskId;
    this.phase = config.phase;
    this.workDir = config.workDir;
    this.statusFile = path.join(this.workDir, '.expert-status.json');
  }

  async run() {
    await this.updateStatus({ state: 'running', progress: 0 });
    
    try {
      // 1. 读取输入文件
      const plan = await this.readPlan();
      
      // 2. 执行任务
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        
        await this.updateStatus({ 
          state: 'running', 
          progress: i / plan.steps.length,
          message: `执行步骤: ${step.name}`
        });
        
        await this.executeStep(step);
      }
      
      // 3. 完成处理
      await this.updateStatus({ 
        state: 'completed', 
        progress: 1,
        message: '执行完成'
      });
      
    } catch (error) {
      if (error instanceof WaitingInputError) {
        await this.updateStatus({
          state: 'waiting_input',
          waiting_for: error.waitingFor,
        });
      } else if (error instanceof BlockedError) {
        await this.updateStatus({
          state: 'blocked',
          block_reason: error.blockReason,
        });
      } else {
        await this.updateStatus({
          state: 'failed',
          error: error.message,
        });
      }
    }
  }

  async updateStatus(partial) {
    const status = {
      expert: 'worker',
      phase: this.phase,
      state: 'running',
      progress: 0,
      message: '',
      waiting_for: null,
      block_reason: null,
      error: null,
      updated_at: new Date().toISOString(),
      ...partial,
    };
    
    await fs.writeFile(this.statusFile, JSON.stringify(status, null, 2));
  }

  async executeStep(step) {
    // 执行具体步骤
    // 可能需要调用工具、访问文件等
  }
}
```

### 6.2 专家启动脚本

```javascript
// 主循环启动专家进程
async function launchExpert(sandbox, execution, task) {
  const expertRole = execution.expert_role;
  
  // 构建启动命令
  const command = `
    cd ${sandbox.workDir} && \
    node ${EXPERT_SCRIPTS_PATH}/${expertRole}.js \
      --task-id=${task.task_id} \
      --phase=${execution.phase} \
      --work-dir=${sandbox.workDir}
  `;
  
  // 在沙箱中执行
  const result = await sandboxPool.execute(sandbox.id, command, {
    timeout: execution.timeout_at - Date.now(),
    background: true,  // 后台运行，不等待完成
  });
  
  return result;
}
```

---

## 7. 数据库设计

### 7.1 expert_executions 表

```sql
CREATE TABLE expert_executions (
    id VARCHAR(64) PRIMARY KEY,
    sandbox_id VARCHAR(64) NOT NULL,
    task_id VARCHAR(100) NOT NULL,
    expert_id VARCHAR(32) NOT NULL COMMENT '专家ID',
    expert_role VARCHAR(32) NOT NULL COMMENT 'dialog/analyst/worker/reviewer',
    phase VARCHAR(20) NOT NULL COMMENT 'ANALYSIS/PROCESS/REVIEW',
    
    status ENUM('pending', 'running', 'waiting_input', 'completed', 'blocked', 'failed', 'timeout')
        DEFAULT 'pending',
    
    progress DECIMAL(3,2) DEFAULT 0 COMMENT '进度 0-1',
    message TEXT COMMENT '状态消息',
    waiting_for TEXT COMMENT '等待的输入JSON',
    block_reason TEXT COMMENT '阻塞原因JSON',
    error_message TEXT COMMENT '错误信息',
    
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    timeout_at TIMESTAMP NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (sandbox_id) REFERENCES sandboxes(id) ON DELETE CASCADE,
    INDEX idx_task (task_id),
    INDEX idx_status (status),
    INDEX idx_timeout (timeout_at)
) COMMENT '专家执行记录';
```

### 7.2 task_events 表（审计日志）

```sql
CREATE TABLE task_events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    task_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(50) NOT NULL COMMENT '事件类型',
    event_data TEXT COMMENT '事件数据JSON',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_task (task_id),
    INDEX idx_type (event_type)
) COMMENT 'Task事件日志';
```

---

## 8. 完整流程示例

```
用户: "帮我分析这个PDF并生成报告"

1. 创建 Task (T20260301_001)
   └── 状态: NEW

2. 用户上传 PDF 文件
   └── 文件: 00-requirements/uploads/report.pdf

3. Task 状态变更: ANALYSIS

4. 主循环 tick():
   ┌────────────────────────────────────────────────────────┐
   │ 发现 Task T001 状态=ANALYSIS，无活跃执行               │
   │                                                        │
   │ 启动 Analyst:                                          │
   │ ├── 获取沙箱 user_1_T001_analyst                       │
   │ ├── 创建执行记录 (status=pending)                      │
   │ ├── 准备输入文件                                       │
   │ └── 启动进程 node analyst.js ...                       │
   └────────────────────────────────────────────────────────┘

5. 主循环 tick():
   ┌────────────────────────────────────────────────────────┐
   │ 问询执行 T001_analyst:                                  │
   │ └── 读取 .status: state=running, progress=30%          │
   └────────────────────────────────────────────────────────┘

6. 主循环 tick():
   ┌────────────────────────────────────────────────────────┐
   │ 问询执行 T001_analyst:                                  │
   │ └── 读取 .status: state=waiting_input, need=pdf_file   │
   │                                                        │
   │ 提供输入:                                              │
   │ └── 复制 PDF 到工作目录                                │
   └────────────────────────────────────────────────────────┘

7. 主循环 tick():
   ┌────────────────────────────────────────────────────────┐
   │ 问询执行 T001_analyst:                                  │
   │ └── 读取 .status: state=completed, progress=100%       │
   │                                                        │
   │ 完成:                                                  │
   │ ├── 收集结果: 01-analysis/plan.md                      │
   │ ├── 释放沙箱 user_1_T001_analyst                       │
   │ └── 推进状态: ANALYSIS → PROCESS                       │
   └────────────────────────────────────────────────────────┘

8. 主循环 tick():
   ┌────────────────────────────────────────────────────────┐
   │ 发现 Task T001 状态=PROCESS，无活跃执行                 │
   │                                                        │
   │ 启动 Worker:                                           │
   │ ├── 获取沙箱 user_1_T001_worker                        │
   │ ├── 权限: 02-process/ 读写, 01-analysis/ 只读          │
   │ └── 启动进程 node worker.js ...                        │
   └────────────────────────────────────────────────────────┘

9. ... Worker 执行中 ...

10. 主循环 tick():
    ┌────────────────────────────────────────────────────────┐
    │ 问询执行 T001_worker:                                   │
    │ └── 读取 .status: state=blocked, reason=dependency     │
    │                                                         │
    │ 处理阻塞:                                               │
    │ ├── 尝试自动安装依赖                                   │
    │ └── 成功，更新状态为 running                           │
    └────────────────────────────────────────────────────────┘

11. ... Worker 完成 ...

12. 推进: PROCESS → REVIEW

13. 启动 Reviewer，执行审核...

14. 推进: REVIEW → DONE

15. 归档，清理所有沙箱
```

---

## 9. 变更记录

| 日期 | 变更内容 |
|------|----------|
| 2026-03-01 | 初始版本：主循环设计、通信协议、完整流程 |

---

## 10. 相关文档

- [沙箱架构设计](./sandbox-architecture.md)
- [Task Layer 设计](./task-layer-design.md)
- [后台任务调度器设计](./background-task-scheduler-design.md)