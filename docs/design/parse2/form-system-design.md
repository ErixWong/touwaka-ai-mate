# 插件式交互表单系统设计 v2

## 概述

设计一个可插拔的表单系统，允许技能通过工具调用来在右侧面板呈现表单，收集用户输入，**由统一后端处理提交，支持AI审核和外部系统对接**。

## 核心设计原则

| 原则 | 说明 |
|------|------|
| **前端只收集** | Vue组件只负责表单渲染和数据收集，提交到统一后端API |
| **后端统一处理** | 后端负责AI审核、数据转换、凭证注入、外发目标系统 |
| **配置驱动** | 表单目标系统、字段映射、凭证通过配置管理，不硬编码 |
| **安全隔离** | 第三方凭证由后端安全存储，前端不可见 |

## 核心概念

| 概念 | 说明 |
|------|------|
| **Form Tool** | 技能中声明的表单类型工具，用于呈现特定表单 |
| **Form Instance** | 用户正在填写的表单实例，有唯一ID和状态 |
| **Form Template** | 表单的结构定义（字段、验证规则、数据源等） |
| **Form Panel** | 右侧面板中的表单标签页，显示当前和历史表单 |

## 架构设计

### 1. 数据库表设计

```sql
-- =============================================
-- 表单目标系统配置表
-- 配置表单数据要发往的外部系统
-- =============================================
CREATE TABLE form_destinations (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL COMMENT '目标系统名称（如：公司HRM）',
    description TEXT COMMENT '描述',
    
    -- 目标系统类型
    type ENUM('api', 'webhook', 'skill', 'database') NOT NULL COMMENT '对接类型',
    
    -- API/Webhook配置
    config JSON NOT NULL COMMENT '连接配置',
    -- 示例：
    -- {
    --   "base_url": "https://hrm.company.com/api",
    --   "auth_type": "bearer",  // bearer, basic, api_key, oauth2
    --   "auth_config": {
    --     "token_header": "Authorization",
    --     "token_prefix": "Bearer "
    --   },
    --   "endpoints": {
    --     "submit": { "path": "/leave-requests", "method": "POST" },
    --     "query": { "path": "/leave-requests/{id}", "method": "GET" }
    --   },
    --   "retry_policy": { "max_retries": 3, "retry_interval": 1000 }
    -- }
    
    -- 凭证引用（实际凭证存储在 secure_credentials 表）
    credential_id VARCHAR(32) COMMENT '关联的凭证ID',
    
    is_active BIT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (credential_id) REFERENCES secure_credentials(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='表单目标系统配置表';

-- =============================================
-- 安全凭证表
-- 存储第三方系统的API Key、Token等敏感信息
-- =============================================
CREATE TABLE secure_credentials (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL COMMENT '凭证名称',
    type ENUM('api_key', 'bearer_token', 'basic_auth', 'oauth2', 'custom') NOT NULL,
    
    -- 加密存储的凭证值
    encrypted_value TEXT NOT NULL COMMENT '加密后的凭证',
    encryption_key_id VARCHAR(32) COMMENT '使用的加密密钥ID',
    
    -- 作用域控制
    scope_type ENUM('global', 'skill', 'user', 'form') DEFAULT 'global',
    scope_id VARCHAR(32) COMMENT '作用域ID（如skill_id）',
    
    -- 过期管理
    expires_at TIMESTAMP NULL,
    last_used_at TIMESTAMP NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_scope (scope_type, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='安全凭证表';

-- =============================================
-- 表单模板定义表
-- 存储技能的表单结构定义
-- =============================================
CREATE TABLE form_templates (
    id VARCHAR(32) PRIMARY KEY,
    skill_id VARCHAR(32) NOT NULL COMMENT '所属技能ID',
    tool_name VARCHAR(64) NOT NULL COMMENT '工具名称（如 create_leave_request）',
    name VARCHAR(128) NOT NULL COMMENT '表单显示名称',
    description TEXT COMMENT '表单描述',
    
    -- 表单结构定义（JSON Schema格式）
    schema JSON NOT NULL COMMENT '表单字段定义',
    
    -- 数据源配置（字段的动态数据从哪获取）
    data_sources JSON COMMENT '动态数据源配置',
    
    -- 目标系统配置（表单提交后发往何处）
    destination_id VARCHAR(32) COMMENT '关联的目标系统ID',
    
    -- 字段映射配置（表单字段如何映射到目标系统字段）
    field_mapping JSON COMMENT '字段映射规则',
    -- 示例：
    -- {
    --   "leave_type": { "target": "type", "transform": "uppercase" },
    --   "start_date": { "target": "startDate", "transform": "iso_date" },
    --   "approver": { "target": "approverId", "transform": "extract_id" }
    -- }
    
    -- AI审核配置
    ai_review_config JSON COMMENT 'AI审核配置',
    -- 示例：
    -- {
    --   "enabled": true,
    --   "prompt_template": "请审核请假申请：类型{leave_type}，天数{days}，事由{reason}...",
    --   "auto_approve": false,  // 是否自动通过AI审核
    --   "required_fields": ["reason", "approver"]  // AI必须检查的字段
    -- }
    
    -- 验证规则
    validation_rules JSON COMMENT '自定义验证规则',
    
    is_active BIT(1) DEFAULT 1 COMMENT '是否启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_skill_tool (skill_id, tool_name),
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
    FOREIGN KEY (destination_id) REFERENCES form_destinations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='表单模板定义表';

-- =============================================
-- 表单实例表
-- 存储用户创建的表单实例（提交后保留）
-- =============================================
CREATE TABLE form_instances (
    id VARCHAR(32) PRIMARY KEY,
    template_id VARCHAR(32) NOT NULL COMMENT '表单模板ID',
    user_id VARCHAR(32) NOT NULL COMMENT '创建用户ID',
    expert_id VARCHAR(32) NOT NULL COMMENT '所属专家ID',
    topic_id VARCHAR(32) COMMENT '关联话题ID',
    
    -- 表单数据
    form_data JSON COMMENT '表单填写数据（提交前为空或草稿）',
    
    -- 状态管理
    status ENUM('draft', 'submitting', 'submitted', 'processing', 'completed', 'failed', 'cancelled') 
        DEFAULT 'draft' COMMENT '表单状态',
    
    -- 提交信息
    submitted_at TIMESTAMP NULL COMMENT '提交时间',
    submit_result JSON COMMENT '提交结果（成功/失败信息）',
    
    -- AI审核信息
    ai_review_status ENUM('pending', 'approved', 'rejected', 'modified') 
        DEFAULT 'pending' COMMENT 'AI审核状态',
    ai_review_comment TEXT COMMENT 'AI审核意见',
    
    -- 关联消息（用于在对话中显示）
    message_id VARCHAR(32) COMMENT '关联的系统消息ID',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user_status (user_id, status),
    INDEX idx_expert (expert_id),
    INDEX idx_topic (topic_id),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (template_id) REFERENCES form_templates(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='表单实例表';

-- =============================================
-- 表单附件表（支持文件上传）
-- =============================================
CREATE TABLE form_attachments (
    id VARCHAR(32) PRIMARY KEY,
    form_instance_id VARCHAR(32) NOT NULL COMMENT '表单实例ID',
    field_name VARCHAR(64) NOT NULL COMMENT '表单字段名',
    file_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
    file_path VARCHAR(500) NOT NULL COMMENT '存储路径',
    file_size INT NOT NULL COMMENT '文件大小（字节）',
    mime_type VARCHAR(128) COMMENT '文件类型',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (form_instance_id) REFERENCES form_instances(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='表单附件表';
```

### 2. 表单 Schema 定义格式

```typescript
// 表单模板 Schema 结构
interface FormTemplateSchema {
  // 表单字段定义
  fields: FormField[];
  
  // 表单布局配置
  layout?: {
    type: 'single' | 'tabs' | 'steps';
    columns?: number; // 多列布局
  };
  
  // 操作按钮配置
  actions: {
    submit: {
      label: string;
      validate: boolean;
    };
    cancel?: {
      label: string;
    };
    saveDraft?: {
      label: string;
      enabled: boolean;
    };
  };
}

// 表单字段定义
interface FormField {
  name: string;           // 字段标识（英文）
  label: string;          // 显示标签
  type: FormFieldType;    // 字段类型
  required?: boolean;     // 是否必填
  placeholder?: string;   // 占位提示
  helpText?: string;      // 帮助说明
  
  // 数据源（用于下拉、单选、多选等）
  dataSource?: {
    type: 'static' | 'api' | 'skill';
    // static: 直接定义选项
    options?: Array<{ label: string; value: any }>;
    // api: 从外部API获取
    apiEndpoint?: string;
    apiMethod?: 'GET' | 'POST';
    // skill: 调用技能获取
    skillId?: string;
    skillTool?: string;
    skillParams?: Record<string, any>;
  };
  
  // 验证规则
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;       // 正则表达式
    custom?: string;      // 自定义验证函数名
  };
  
  // 字段联动（显示/隐藏条件）
  visibility?: {
    dependsOn: string;    // 依赖的字段名
    condition: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan';
    value: any;
  };
  
  // 默认值
  defaultValue?: any;
}

type FormFieldType = 
  | 'text'           // 单行文本
  | 'textarea'       // 多行文本
  | 'number'         // 数字
  | 'date'           // 日期
  | 'datetime'       // 日期时间
  | 'select'         // 下拉选择
  | 'multiselect'    // 多选下拉
  | 'radio'          // 单选按钮
  | 'checkbox'       // 复选框
  | 'switch'         // 开关
  | 'file'           // 文件上传
  | 'image'          // 图片上传
  | 'userpicker'     // 用户选择器（复用现有组件）
  | 'department'     // 部门选择
  | 'richtext'       // 富文本编辑器
  | 'markdown'       // Markdown编辑器
  | 'json';          // JSON编辑器
```

### 3. 统一后端处理架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           表单提交流程                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  前端提交表单数据                                                        │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. 统一表单处理器 (Form Submission Handler)                     │   │
│  │     • 接收表单数据                                               │   │
│  │     • 基础验证（必填、格式）                                     │   │
│  │     • 附件处理                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  2. AI审核钩子 (AI Review Hook)                                  │   │
│  │     • 加载表单模板配置的ai_review_config                         │   │
│  │     • 调用LLM审核表单内容                                        │   │
│  │     • 返回审核结果（通过/拒绝/建议修改）                          │   │
│  │     • 如拒绝，直接返回前端，不继续处理                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  3. 数据转换器 (Data Transformer)                                │   │
│  │     • 根据field_mapping转换字段名                               │   │
│  │     • 数据格式转换（日期、编码等）                               │   │
│  │     • 注入系统字段（user_id, timestamp等）                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  4. 凭证注入器 (Credential Injector)                             │   │
│  │     • 从secure_credentials获取目标系统凭证                        │   │
│  │     • 解密凭证                                                   │   │
│  │     • 按目标系统要求注入到请求头或请求体                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  5. 目标系统分发器 (Destination Dispatcher)                      │   │
│  │     • 根据destination_id获取目标系统配置                          │   │
│  │     • 构建HTTP请求                                               │   │
│  │     • 发送数据到外部系统                                         │   │
│  │     • 处理响应和错误                                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  6. 结果处理器 (Result Handler)                                    │   │
│  │     • 保存提交结果到form_instances                               │   │
│  │     • 生成系统消息插入对话                                       │   │
│  │     • 返回结果给前端                                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4. 后端 API 设计

```typescript
// ============================================
// 表单目标系统管理 API（管理员）
// ============================================

// 创建目标系统配置
POST /api/form-destinations
Request: {
  name: string;
  description?: string;
  type: 'api' | 'webhook' | 'skill' | 'database';
  config: {
    base_url?: string;
    auth_type: 'bearer' | 'basic' | 'api_key' | 'oauth2';
    auth_config: Record<string, any>;
    endpoints?: Record<string, { path: string; method: string }>;
    retry_policy?: { max_retries: number; retry_interval: number };
  };
  credential_id?: string; // 关联的凭证ID
}

// 获取目标系统列表
GET /api/form-destinations

// 测试目标系统连接
POST /api/form-destinations/:id/test
Response: { success: boolean; message: string; latency: number }


// ============================================
// 凭证管理 API（管理员）
// ============================================

// 创建凭证
POST /api/secure-credentials
Request: {
  name: string;
  type: 'api_key' | 'bearer_token' | 'basic_auth' | 'oauth2';
  value: string; // 明文，后端加密存储
  scope_type: 'global' | 'skill' | 'user' | 'form';
  scope_id?: string;
  expires_at?: string;
}

// 获取凭证列表（不返回敏感值）
GET /api/secure-credentials
Response: {
  id: string;
  name: string;
  type: string;
  scope_type: string;
  expires_at?: string;
  last_used_at?: string;
}[]

// 更新凭证
PUT /api/secure-credentials/:id
Request: { value?: string; expires_at?: string }


// ============================================
// 表单模板管理 API（管理员/技能开发者）
// ============================================

// 创建表单模板
POST /api/form-templates
Request: {
  skill_id: string;
  tool_name: string;
  name: string;
  description?: string;
  schema: FormTemplateSchema;
  data_sources?: Record<string, DataSourceConfig>;
  destination_id?: string;        // 目标系统
  field_mapping?: Record<string, FieldMappingRule>;
  ai_review_config?: AIReviewConfig;
  validation_rules?: ValidationRule[];
}

// 获取技能的表单模板列表
GET /api/skills/:skill_id/form-templates

// 获取单个表单模板
GET /api/form-templates/:id

// 更新表单模板
PUT /api/form-templates/:id

// 删除表单模板
DELETE /api/form-templates/:id

// 预览表单（测试渲染）
POST /api/form-templates/:id/preview
Response: { rendered_form: FormTemplate }


// ============================================
// 表单实例 API（用户操作）
// ============================================

// 创建表单实例（打开新表单）
POST /api/form-instances
Request: {
  template_id: string;
  expert_id: string;
  topic_id?: string;
}
Response: {
  id: string;
  template: FormTemplate;  // 只返回schema，不包含敏感配置
  status: 'draft';
  created_at: string;
}

// 获取表单实例详情
GET /api/form-instances/:id

// 更新表单数据（自动保存草稿）
PATCH /api/form-instances/:id/data
Request: {
  form_data: Record<string, any>;
}

// 【核心】提交表单 - 统一后端处理
POST /api/form-instances/:id/submit
Request: {
  form_data: Record<string, any>;
  attachments?: string[];
}
Response: {
  id: string;
  status: 'submitted' | 'processing' | 'completed' | 'failed';
  message: string;
  
  // AI审核结果
  ai_review?: {
    status: 'approved' | 'rejected' | 'modified';
    comment: string;
    suggested_changes?: Record<string, any>;
  };
  
  // 目标系统响应
  destination_response?: {
    success: boolean;
    external_id?: string;      // 外部系统生成的ID
    external_url?: string;     // 外部系统查看链接
    message?: string;
    raw_response?: any;        // 原始响应（调试用）
  };
}

// 取消表单
POST /api/form-instances/:id/cancel

// 获取用户的表单列表
GET /api/form-instances?status=&expert_id=&page=&size=

// 上传表单附件
POST /api/form-instances/:id/attachments
Content-Type: multipart/form-data


// ============================================
// 表单数据源 API（后端代理，安全访问外部数据）
// ============================================

// 获取表单字段的动态数据
// 后端根据data_sources配置，代理请求到目标系统
GET /api/form-instances/:id/data-source/:field_name

// 实时搜索（后端代理，注入凭证）
GET /api/form-data-sources/search-users?q=&department_id=
GET /api/form-data-sources/departments
GET /api/form-data-sources/positions
```

### 5. 技能集成设计（新架构）

#### 5.1 架构变化说明

**旧方式**：技能自己处理表单提交，直接调用外部API
**新方式**：技能只声明表单模板，统一后端处理提交和外部对接

```
┌─────────────────────────────────────────────────────────────┐
│  新架构下的技能职责                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  技能只需要：                                                │
│  1. 声明表单模板（在SKILL.md或数据库中配置）                 │
│  2. 返回表单触发指令（告诉系统要打开哪个表单）                 │
│                                                             │
│  技能不需要：                                                │
│  × 处理表单提交逻辑                                         │
│  × 管理外部API凭证                                          │
│  × 处理AI审核                                               │
│  × 数据格式转换                                             │
│                                                             │
│  这些全部由统一后端处理！                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 5.2 SKILL.md 配置示例

```markdown
---
name: hrm
description: "人力资源管理系统集成"
---

## 工具列表

| 工具 | 说明 | 关键参数 |
|---|---|---|
| create_leave_request | 创建请假申请 | 呈现表单 |
| create_expense_report | 创建报销申请 | 呈现表单 |
| query_leave_balance | 查询年假余额 | - |

## 表单模板配置

### create_leave_request

```yaml
form_template:
  name: "请假申请单"
  description: "填写并提交请假申请"
  
  # 表单字段定义
  schema:
    fields:
      - name: leave_type
        label: "请假类型"
        type: select
        required: true
        dataSource:
          type: static
          options:
            - label: "年假"
              value: annual
            - label: "病假"
              value: sick
            - label: "事假"
              value: personal
      
      - name: start_date
        label: "开始日期"
        type: date
        required: true
      
      - name: end_date
        label: "结束日期"
        type: date
        required: true
      
      - name: days
        label: "请假天数"
        type: number
        required: true
        validation:
          min: 0.5
          max: 30
      
      - name: reason
        label: "请假事由"
        type: textarea
        required: true
        validation:
          minLength: 10
          maxLength: 500
      
      - name: approver
        label: "审批人"
        type: userpicker
        required: true
        dataSource:
          type: api
          apiEndpoint: "/api/hrm/available-approvers"  # 后端代理
      
      - name: attachments
        label: "附件"
        type: file
        required: false
        helpText: "病假请上传医院证明"
        visibility:
          dependsOn: leave_type
          condition: equals
          value: sick
    
    actions:
      submit:
        label: "提交申请"
        validate: true
      cancel:
        label: "取消"
      saveDraft:
        label: "保存草稿"
        enabled: true
  
  # 目标系统配置（由管理员在后台配置，技能只引用ID）
  # destination_id: "dest_hrm_prod"  # 可选：指定目标系统
  
  # 字段映射（表单字段 → 目标系统字段）
  field_mapping:
    leave_type:
      target: "type"
      transform: "uppercase"
    start_date:
      target: "startDate"
      transform: "iso_date"
    end_date:
      target: "endDate"
      transform: "iso_date"
    days:
      target: "duration"
    reason:
      target: "reason"
    approver:
      target: "approverId"
      transform: "extract_id"  # 从用户对象提取ID
  
  # AI审核配置
  ai_review_config:
    enabled: true
    prompt_template: |
      请审核以下请假申请：
      请假类型：{leave_type}
      请假天数：{days}天
      时间：{start_date} 至 {end_date}
      事由：{reason}
      审批人：{approver}
      
      审核要点：
      1. 请假天数是否合理（年假剩余是否充足）
      2. 事由是否充分、合规
      3. 审批人是否有权限
      
      请给出审核意见：
      - 如果通过，回复"审核通过"
      - 如果有问题，指出具体问题
    auto_approve: false  # 是否自动通过（无需人工确认）
    required_fields: ["reason", "approver"]  # AI必须检查的字段
```

#### 5.3 技能代码（简化版）

```javascript
// data/skills/hrm/index.js

async function execute(toolName, params, context) {
  switch (toolName) {
    case 'create_leave_request':
      // 只需返回指令，告诉系统打开表单
      // 实际表单定义从数据库的form_templates加载
      return {
        type: 'open_form',
        form_template_id: 'form_tpl_hrm_leave',  // 表单模板ID
        // 预填充数据（可选）
        initial_data: {
          applicant_name: context.user_name,
          department: context.user_department,
        }
      };
    
    case 'query_leave_balance':
      // 普通查询工具，不涉及表单
      const balance = await queryLeaveBalance(context.user_id);
      return {
        type: 'result',
        content: `您今年剩余年假 ${balance.annual} 天，病假 ${balance.sick} 天。`
      };
    
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

#### 5.4 管理员配置界面（后端管理）

```yaml
# 管理员在系统后台配置目标系统和凭证

# 1. 配置目标系统
destinations:
  - id: "dest_hrm_prod"
    name: "公司HRM系统（生产）"
    type: "api"
    config:
      base_url: "https://hrm.company.com/api/v1"
      auth_type: "bearer"
      auth_config:
        token_header: "Authorization"
        token_prefix: "Bearer "
      endpoints:
        submit:
          path: "/leave-requests"
          method: "POST"
        query:
          path: "/leave-requests/{id}"
          method: "GET"
    credential_id: "cred_hrm_token"

# 2. 配置凭证（加密存储）
credentials:
  - id: "cred_hrm_token"
    name: "HRM系统API Token"
    type: "bearer_token"
    value: "eyJhbGciOiJIUzI1NiIs..."  # 加密存储
    scope_type: "skill"
    scope_id: "hrm"

# 3. 表单模板关联目标系统
form_templates:
  - id: "form_tpl_hrm_leave"
    skill_id: "hrm"
    tool_name: "create_leave_request"
    destination_id: "dest_hrm_prod"  # 关联目标系统
    field_mapping:
      # ... 字段映射配置
```

### 6. 后端处理器实现

#### 6.1 统一表单处理器架构

```typescript
// services/form/FormSubmissionService.ts

export class FormSubmissionService {
  constructor(
    private formTemplateRepo: FormTemplateRepository,
    private formInstanceRepo: FormInstanceRepository,
    private credentialService: SecureCredentialService,
    private aiReviewService: AIReviewService,
    private destinationDispatcher: DestinationDispatcher,
    private messageService: MessageService
  ) {}

  /**
   * 统一表单提交入口
   * 处理流程：验证 → AI审核 → 数据转换 → 凭证注入 → 目标系统分发 → 结果处理
   */
  async submitForm(
    formInstanceId: string,
    formData: Record<string, any>,
    attachments?: string[],
    userContext: UserContext
  ): Promise<FormSubmitResult> {
    const startTime = Date.now();
    
    // 1. 获取表单实例和模板
    const instance = await this.formInstanceRepo.findById(formInstanceId);
    if (!instance) {
      throw new FormNotFoundError(formInstanceId);
    }
    
    const template = await this.formTemplateRepo.findById(instance.template_id);
    if (!template) {
      throw new TemplateNotFoundError(instance.template_id);
    }
    
    // 更新状态为提交中
    await this.formInstanceRepo.updateStatus(formInstanceId, 'submitting');
    
    try {
      // 2. 基础验证
      this.validateFormData(formData, template.schema.fields);
      
      // 3. 处理附件
      if (attachments && attachments.length > 0) {
        await this.processAttachments(formInstanceId, attachments, formData);
      }
      
      // 4. AI审核钩子
      let aiReviewResult: AIReviewResult | undefined;
      if (template.ai_review_config?.enabled) {
        aiReviewResult = await this.aiReviewService.review(
          formData,
          template.ai_review_config,
          userContext
        );
        
        // 如果AI审核拒绝，直接返回
        if (aiReviewResult.status === 'rejected') {
          await this.formInstanceRepo.updateStatus(formInstanceId, 'draft', {
            ai_review_status: 'rejected',
            ai_review_comment: aiReviewResult.comment
          });
          
          return {
            id: formInstanceId,
            status: 'draft',
            message: 'AI审核未通过：' + aiReviewResult.comment,
            ai_review: aiReviewResult
          };
        }
        
        // 如果AI建议修改，返回修改建议
        if (aiReviewResult.status === 'modified' && aiReviewResult.suggested_changes) {
          await this.formInstanceRepo.updateStatus(formInstanceId, 'draft', {
            ai_review_status: 'modified',
            ai_review_comment: aiReviewResult.comment
          });
          
          return {
            id: formInstanceId,
            status: 'draft',
            message: 'AI建议修改：' + aiReviewResult.comment,
            ai_review: aiReviewResult
          };
        }
        
        // AI审核通过，继续处理
        await this.formInstanceRepo.updateAIReview(formInstanceId, 'approved', aiReviewResult.comment);
      }
      
      // 5. 数据转换
      const transformedData = this.transformFormData(
        formData,
        template.field_mapping,
        userContext
      );
      
      // 6. 目标系统分发
      let destinationResponse: DestinationResponse | undefined;
      
      if (template.destination_id) {
        // 更新状态为处理中
        await this.formInstanceRepo.updateStatus(formInstanceId, 'processing');
        
        // 获取目标系统配置和凭证
        const destination = await this.formTemplateRepo.getDestination(template.destination_id);
        const credential = destination.credential_id 
          ? await this.credentialService.getCredential(destination.credential_id)
          : null;
        
        // 分发到目标系统
        destinationResponse = await this.destinationDispatcher.dispatch({
          destination,
          credential,
          data: transformedData,
          formInstanceId
        });
        
        if (!destinationResponse.success) {
          throw new DestinationDispatchError(destinationResponse.message);
        }
      }
      
      // 7. 保存结果
      const finalStatus = destinationResponse ? 'completed' : 'submitted';
      await this.formInstanceRepo.updateStatus(formInstanceId, finalStatus, {
        submitted_at: new Date(),
        submit_result: {
          destination_response: destinationResponse,
          processing_time: Date.now() - startTime
        }
      });
      
      // 8. 生成系统消息
      const message = await this.messageService.createFormSubmitMessage({
        expert_id: instance.expert_id,
        topic_id: instance.topic_id,
        user_id: userContext.user_id,
        form_instance_id: formInstanceId,
        form_name: template.name,
        status: finalStatus,
        summary: this.generateFormSummary(formData, template.schema.fields),
        ai_review: aiReviewResult,
        destination_response: destinationResponse
      });
      
      // 更新实例关联的消息ID
      await this.formInstanceRepo.updateMessageId(formInstanceId, message.id);
      
      return {
        id: formInstanceId,
        status: finalStatus,
        message: destinationResponse?.message || '表单提交成功',
        ai_review: aiReviewResult,
        destination_response: destinationResponse
      };
      
    } catch (error) {
      // 处理失败，更新状态
      await this.formInstanceRepo.updateStatus(formInstanceId, 'failed', {
        submit_result: {
          error: error.message,
          timestamp: new Date()
        }
      });
      
      throw error;
    }
  }
  
  // 表单数据验证
  private validateFormData(
    data: Record<string, any>,
    fields: FormField[]
  ): void {
    const errors: Record<string, string> = {};
    
    for (const field of fields) {
      const value = data[field.name];
      
      // 必填验证
      if (field.required && (value === undefined || value === null || value === '')) {
        errors[field.name] = `${field.label}不能为空`;
        continue;
      }
      
      // 其他验证规则...
      if (field.validation && value !== undefined) {
        // 长度、范围、正则等验证
      }
    }
    
    if (Object.keys(errors).length > 0) {
      throw new FormValidationError(errors);
    }
  }
  
  // 数据转换
  private transformFormData(
    data: Record<string, any>,
    fieldMapping: Record<string, FieldMappingRule>,
    userContext: UserContext
  ): Record<string, any> {
    const result: Record<string, any> = {};
    
    for (const [sourceField, mapping] of Object.entries(fieldMapping)) {
      let value = data[sourceField];
      
      // 应用转换规则
      if (mapping.transform) {
        value = this.applyTransform(value, mapping.transform);
      }
      
      result[mapping.target] = value;
    }
    
    // 注入系统字段
    result._submitter_id = userContext.user_id;
    result._submitter_name = userContext.user_name;
    result._submit_time = new Date().toISOString();
    result._source_system = 'touwaka-mate';
    
    return result;
  }
  
  // 应用转换规则
  private applyTransform(value: any, transform: string): any {
    switch (transform) {
      case 'uppercase':
        return String(value).toUpperCase();
      case 'lowercase':
        return String(value).toLowerCase();
      case 'iso_date':
        return new Date(value).toISOString();
      case 'timestamp':
        return new Date(value).getTime();
      case 'extract_id':
        // 从对象中提取ID，如从用户对象提取user_id
        return value?.id || value;
      case 'json_string':
        return JSON.stringify(value);
      default:
        // 支持自定义转换函数
        if (transform.startsWith('custom:')) {
          const funcName = transform.replace('custom:', '');
          return this.callCustomTransform(funcName, value);
        }
        return value;
    }
  }
  
  // 生成表单摘要
  private generateFormSummary(
    data: Record<string, any>,
    fields: FormField[]
  ): string {
    // 根据字段类型生成摘要
    const summaryFields = fields.filter(f => 
      ['select', 'number', 'date', 'userpicker'].includes(f.type)
    ).slice(0, 3);
    
    return summaryFields.map(f => {
      const value = data[f.name];
      if (f.type === 'userpicker' && typeof value === 'object') {
        return `${f.label}：${value.name || value.label || value}`;
      }
      return `${f.label}：${value}`;
    }).join('，');
  }
}
```

#### 6.2 AI审核服务

```typescript
// services/form/AIReviewService.ts

export class AIReviewService {
  constructor(private llmService: LLMService) {}
  
  async review(
    formData: Record<string, any>,
    config: AIReviewConfig,
    userContext: UserContext
  ): Promise<AIReviewResult> {
    // 构建审核提示词
    const prompt = this.buildReviewPrompt(formData, config, userContext);
    
    // 调用LLM
    const response = await this.llmService.chat({
      messages: [
        { role: 'system', content: '你是一个表单审核助手，负责审核用户提交的表单内容。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3  // 低温度，更确定性
    });
    
    // 解析审核结果
    return this.parseReviewResponse(response.content);
  }
  
  private buildReviewPrompt(
    formData: Record<string, any>,
    config: AIReviewConfig,
    userContext: UserContext
  ): string {
    // 使用模板渲染
    let prompt = config.prompt_template;
    
    // 替换模板变量
    for (const [key, value] of Object.entries(formData)) {
      const placeholder = `{${key}}`;
      const displayValue = this.formatValueForPrompt(value);
      prompt = prompt.replace(new RegExp(placeholder, 'g'), displayValue);
    }
    
    // 添加提交者信息
    prompt += `\n\n提交者：${userContext.user_name}（${userContext.user_department || '未知部门'}）`;
    prompt += `\n提交时间：${new Date().toLocaleString()}`;
    
    return prompt;
  }
  
  private formatValueForPrompt(value: any): string {
    if (value === null || value === undefined) return '未填写';
    if (typeof value === 'object') {
      return value.name || value.label || JSON.stringify(value);
    }
    return String(value);
  }
  
  private parseReviewResponse(content: string): AIReviewResult {
    const lowerContent = content.toLowerCase();
    
    // 检查是否通过
    if (lowerContent.includes('审核通过') || lowerContent.includes('通过')) {
      return {
        status: 'approved',
        comment: content
      };
    }
    
    // 检查是否拒绝
    if (lowerContent.includes('拒绝') || lowerContent.includes('不通过') || lowerContent.includes('问题')) {
      return {
        status: 'rejected',
        comment: content
      };
    }
    
    // 默认建议修改
    return {
      status: 'modified',
      comment: content,
      suggested_changes: this.extractSuggestedChanges(content)
    };
  }
  
  private extractSuggestedChanges(content: string): Record<string, any> | undefined {
    // 尝试从AI回复中提取建议修改的字段值
    // 例如："建议将请假天数改为2天" → { days: 2 }
    // 这需要更复杂的NLP解析，或者让AI以JSON格式返回建议
    return undefined;
  }
}
```

#### 6.3 目标系统分发器

```typescript
// services/form/DestinationDispatcher.ts

export class DestinationDispatcher {
  constructor(private httpClient: HttpClient) {}
  
  async dispatch(params: DispatchParams): Promise<DestinationResponse> {
    const { destination, credential, data, formInstanceId } = params;
    
    // 根据目标系统类型选择分发策略
    switch (destination.type) {
      case 'api':
        return this.dispatchToAPI(destination, credential, data);
      case 'webhook':
        return this.dispatchToWebhook(destination, credential, data);
      case 'skill':
        return this.dispatchToSkill(destination, data);
      case 'database':
        return this.dispatchToDatabase(destination, data);
      default:
        throw new Error(`Unsupported destination type: ${destination.type}`);
    }
  }
  
  private async dispatchToAPI(
    destination: FormDestination,
    credential: SecureCredential | null,
    data: Record<string, any>
  ): Promise<DestinationResponse> {
    const config = destination.config;
    const endpoint = config.endpoints?.submit;
    
    if (!endpoint) {
      throw new Error('API destination missing submit endpoint');
    }
    
    // 构建请求头
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    // 注入凭证
    if (credential) {
      this.injectCredential(headers, credential, config.auth_type, config.auth_config);
    }
    
    // 构建URL
    const url = `${config.base_url}${endpoint.path}`;
    
    // 发送请求
    try {
      const response = await this.httpClient.request({
        method: endpoint.method as any,
        url,
        headers,
        data,
        timeout: 30000,
        retries: config.retry_policy?.max_retries || 3
      });
      
      return {
        success: true,
        external_id: this.extractExternalId(response.data),
        external_url: this.extractExternalUrl(response.data, destination),
        message: '数据已成功提交到目标系统',
        raw_response: response.data
      };
    } catch (error) {
      return {
        success: false,
        message: `目标系统调用失败: ${error.message}`,
        raw_response: error.response?.data
      };
    }
  }
  
  private injectCredential(
    headers: Record<string, string>,
    credential: SecureCredential,
    authType: string,
    authConfig: Record<string, any>
  ): void {
    switch (authType) {
      case 'bearer':
        const prefix = authConfig.token_prefix || 'Bearer ';
        headers[authConfig.token_header || 'Authorization'] = `${prefix}${credential.value}`;
        break;
      case 'api_key':
        if (authConfig.key_in === 'header') {
          headers[authConfig.key_name] = credential.value;
        }
        // 如果是query参数，在URL中处理
        break;
      case 'basic':
        const basicAuth = Buffer.from(credential.value).toString('base64');
        headers['Authorization'] = `Basic ${basicAuth}`;
        break;
      // OAuth2需要更复杂的处理，包括token刷新
    }
  }
  
  private extractExternalId(responseData: any): string | undefined {
    // 尝试从常见字段提取外部ID
    const possibleFields = ['id', 'request_id', 'leave_id', 'form_id', 'external_id'];
    for (const field of possibleFields) {
      if (responseData[field]) {
        return String(responseData[field]);
      }
    }
    return undefined;
  }
  
  private extractExternalUrl(responseData: any, destination: FormDestination): string | undefined {
    // 如果目标系统配置了查看端点，构建查看URL
    const queryEndpoint = destination.config.endpoints?.query;
    if (queryEndpoint && responseData.id) {
      const path = queryEndpoint.path.replace('{id}', responseData.id);
      return `${destination.config.base_url}${path}`;
    }
    return responseData.url || responseData.view_url;
  }
}
```

### 7. 凭证管理UI设计

#### 7.1 凭证管理界面

```vue
<!-- admin/SecureCredentialManager.vue -->
<template>
  <div class="credential-manager">
    <div class="page-header">
      <h2>安全凭证管理</h2>
      <button class="btn-primary" @click="showCreateDialog = true">
        + 新建凭证
      </button>
    </div>
    
    <!-- 凭证列表 -->
    <div class="credential-list">
      <div 
        v-for="cred in credentials" 
        :key="cred.id"
        class="credential-card"
        :class="{ expired: isExpired(cred) }"
      >
        <div class="credential-header">
          <span class="credential-name">{{ cred.name }}</span>
          <span class="credential-type">{{ typeLabel(cred.type) }}</span>
          <span v-if="isExpired(cred)" class="badge-expired">已过期</span>
        </div>
        
        <div class="credential-meta">
          <span>作用域：{{ scopeLabel(cred.scope_type, cred.scope_id) }}</span>
          <span>创建时间：{{ formatTime(cred.created_at) }}</span>
          <span v-if="cred.expires_at">
            过期时间：{{ formatTime(cred.expires_at) }}
          </span>
          <span v-if="cred.last_used_at">
            最后使用：{{ formatTime(cred.last_used_at) }}
          </span>
        </div>
        
        <div class="credential-actions">
          <button @click="editCredential(cred)">编辑</button>
          <button @click="testCredential(cred)">测试</button>
          <button @click="deleteCredential(cred.id)" class="btn-danger">删除</button>
        </div>
      </div>
    </div>
    
    <!-- 创建/编辑对话框 -->
    <CredentialDialog
      v-model:visible="showCreateDialog"
      :credential="editingCredential"
      @save="handleSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { credentialApi } from '@/api/admin'

const credentials = ref<SecureCredential[]>([])
const showCreateDialog = ref(false)
const editingCredential = ref<SecureCredential | null>(null)

onMounted(async () => {
  await loadCredentials()
})

async function loadCredentials() {
  credentials.value = await credentialApi.list()
}

function isExpired(cred: SecureCredential): boolean {
  if (!cred.expires_at) return false
  return new Date(cred.expires_at) < new Date()
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    api_key: 'API Key',
    bearer_token: 'Bearer Token',
    basic_auth: 'Basic Auth',
    oauth2: 'OAuth 2.0',
    custom: '自定义'
  }
  return map[type] || type
}

function scopeLabel(scopeType: string, scopeId?: string): string {
  const map: Record<string, string> = {
    global: '全局',
    skill: `技能 (${scopeId})`,
    user: `用户 (${scopeId})`,
    form: `表单 (${scopeId})`
  }
  return map[scopeType] || scopeType
}
</script>
```

#### 7.2 目标系统配置界面

```vue
<!-- admin/FormDestinationManager.vue -->
<template>
  <div class="destination-manager">
    <div class="page-header">
      <h2>表单目标系统配置</h2>
      <button class="btn-primary" @click="showCreateDialog = true">
        + 新建目标系统
      </button>
    </div>
    
    <!-- 目标系统列表 -->
    <div class="destination-list">
      <div 
        v-for="dest in destinations" 
        :key="dest.id"
        class="destination-card"
      >
        <div class="destination-header">
          <span class="destination-name">{{ dest.name }}</span>
          <span class="destination-type">{{ typeLabel(dest.type) }}</span>
          <span 
            class="status-badge"
            :class="dest.is_active ? 'active' : 'inactive'"
          >
            {{ dest.is_active ? '启用' : '禁用' }}
          </span>
        </div>
        
        <div class="destination-config">
          <p><strong>类型：</strong>{{ dest.type }}</p>
          <p v-if="dest.config.base_url">
            <strong>基础URL：</strong>{{ dest.config.base_url }}
          </p>
          <p v-if="dest.config.auth_type">
            <strong>认证方式：</strong>{{ dest.config.auth_type }}
          </p>
          <p v-if="dest.credential_id">
            <strong>关联凭证：</strong>{{ getCredentialName(dest.credential_id) }}
          </p>
        </div>
        
        <div class="destination-actions">
          <button @click="testConnection(dest)">测试连接</button>
          <button @click="editDestination(dest)">编辑</button>
          <button @click="toggleStatus(dest)">
            {{ dest.is_active ? '禁用' : '启用' }}
          </button>
        </div>
      </div>
    </div>
    
    <!-- 创建/编辑对话框 -->
    <DestinationDialog
      v-model:visible="showCreateDialog"
      :destination="editingDestination"
      :credentials="availableCredentials"
      @save="handleSave"
    />
  </div>
</template>
```

### 8. 前端架构设计

#### 8.0 表单构造器设计（可视化配置）

##### 8.0.1 构造器架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         表单构造器（管理员工具）                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  左侧：组件面板                                                   │   │
│  │  • 基础字段（文本、数字、日期、下拉等）                           │   │
│  │  • 高级字段（文件上传、用户选择、部门选择）                         │   │
│  │  • 布局组件（分组、标签页、分步）                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  中间：画布/设计区                                                │   │
│  │  • 拖拽字段到画布                                                │   │
│  │  • 点击字段编辑属性                                               │   │
│  │  • 拖拽排序                                                       │   │
│  │  • 实时预览                                                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  右侧：属性面板                                                   │   │
│  │  • 字段基础属性（名称、标签、类型、必填）                          │   │
│  │  • 数据源配置（静态选项/API/技能）                                │   │
│  │  • 验证规则（必填、长度、正则、自定义）                            │   │
│  │  • 联动规则（显示/隐藏条件）                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  顶部：工具栏                                                     │   │
│  │  • 保存/发布                                                     │   │
│  │  • 预览                                                          │   │
│  │  • 导入/导出JSON                                                 │   │
│  │  • 配置目标系统和AI审核                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 8.0.2 构造器数据模型

```typescript
// 构造器内部使用的表单设计模型
interface FormDesignerModel {
  // 基础信息
  id?: string;
  name: string;
  description?: string;
  skill_id: string;
  tool_name: string;
  
  // 字段设计
  fields: FormFieldDesign[];
  
  // 布局配置
  layout: {
    type: 'single' | 'tabs' | 'steps';
    columns: 1 | 2 | 3;
  };
  
  // 数据源配置（字段用到的数据源）
  dataSources: Record<string, DataSourceConfig>;
  
  // 目标系统配置
  destination?: {
    destination_id: string;
    field_mapping: Record<string, FieldMappingRule>;
  };
  
  // AI审核配置
  aiReview?: AIReviewConfig;
  
  // 操作按钮
  actions: FormActionsConfig;
}

// 字段设计（包含完整配置）
interface FormFieldDesign {
  id: string;  // 前端生成的临时ID
  name: string;  // 字段标识（英文，用于提交）
  label: string;  // 显示标签
  type: FormFieldType;
  
  // 基础属性
  required: boolean;
  placeholder?: string;
  helpText?: string;
  defaultValue?: any;
  
  // 数据源（如果是选择类字段）
  dataSource?: DataSourceConfig;
  
  // 验证规则
  validation?: ValidationRuleConfig;
  
  // 联动规则
  visibility?: VisibilityRule;
  
  // 样式配置
  width?: 'full' | '1/2' | '1/3';  // 字段宽度
  customClass?: string;
}

// 数据源配置
interface DataSourceConfig {
  type: 'static' | 'api' | 'skill' | 'database';
  
  // static: 直接定义选项
  staticOptions?: Array<{ label: string; value: any; disabled?: boolean }>;
  
  // api: 调用外部API（后端代理）
  apiConfig?: {
    endpoint: string;  // 如 "/api/hrm/leave-types"
    method: 'GET' | 'POST';
    params?: Record<string, any>;
    labelField: string;  // 响应中作为label的字段
    valueField: string;  // 响应中作为value的字段
  };
  
  // skill: 调用技能获取数据
  skillConfig?: {
    skillId: string;
    toolName: string;
    params?: Record<string, any>;
  };
  
  // database: 从数据库查询
  databaseConfig?: {
    table: string;
    fields: string[];
    where?: Record<string, any>;
  };
}

// 验证规则配置
interface ValidationRuleConfig {
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;  // 正则表达式
  patternMessage?: string;  // 正则验证失败提示
  customValidator?: string;  // 自定义验证函数名（后端提供）
}

// 联动规则
interface VisibilityRule {
  enabled: boolean;
  conditions: VisibilityCondition[];
  logic: 'and' | 'or';  // 多个条件的逻辑关系
}

interface VisibilityCondition {
  field: string;  // 依赖的字段名
  operator: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan' | 'isEmpty' | 'isNotEmpty';
  value?: any;  // 比较值
}
```

##### 8.0.3 构造器组件设计

```vue
<!-- FormBuilder.vue -->
<template>
  <div class="form-builder">
    <!-- 顶部工具栏 -->
    <BuilderToolbar
      v-model="formModel"
      @save="handleSave"
      @preview="showPreview"
      @export="exportJSON"
      @import="importJSON"
    />
    
    <div class="builder-body">
      <!-- 左侧组件面板 -->
      <ComponentPanel
        :components="availableComponents"
        @dragstart="onDragStart"
      />
      
      <!-- 中间画布 -->
      <BuilderCanvas
        v-model="formModel.fields"
        :layout="formModel.layout"
        :selected-field="selectedField"
        @select="selectField"
        @drop="onDrop"
        @move="onMove"
        @delete="deleteField"
      />
      
      <!-- 右侧属性面板 -->
      <PropertyPanel
        v-if="selectedField"
        v-model="selectedField"
        :data-sources="formModel.dataSources"
        @update:data-source="updateDataSource"
      />
      
      <!-- 全局配置面板（当没有选中字段时） -->
      <GlobalConfigPanel
        v-else
        v-model="formModel"
        :destinations="availableDestinations"
        :ai-configs="availableAIConfigs"
      />
    </div>
    
    <!-- 预览对话框 -->
    <PreviewDialog
      v-model:visible="previewVisible"
      :form-config="formModel"
    />
  </div>
</template>
```

##### 8.0.4 构造器与技能系统的集成

```typescript
// 表单模板发布流程

async function publishFormTemplate(formDesign: FormDesignerModel) {
  // 1. 验证表单设计
  const validation = validateFormDesign(formDesign);
  if (!validation.valid) {
    throw new Error(validation.errors.join('\n'));
  }
  
  // 2. 转换为目标系统字段映射
  const fieldMapping = buildFieldMapping(formDesign.fields);
  
  // 3. 保存到 form_templates 表
  const template = await formTemplateService.create({
    skill_id: formDesign.skill_id,
    tool_name: formDesign.tool_name,
    name: formDesign.name,
    description: formDesign.description,
    schema: {
      fields: formDesign.fields,
      layout: formDesign.layout,
      actions: formDesign.actions
    },
    data_sources: formDesign.dataSources,
    destination_id: formDesign.destination?.destination_id,
    field_mapping: fieldMapping,
    ai_review_config: formDesign.aiReview,
    is_active: true
  });
  
  // 4. 自动更新 SKILL.md（可选）
  await updateSkillMarkdown(formDesign.skill_id, template);
  
  return template;
}

// 验证表单设计
function validateFormDesign(design: FormDesignerModel): ValidationResult {
  const errors: string[] = [];
  
  // 检查必填项
  if (!design.name) errors.push('表单名称不能为空');
  if (!design.tool_name) errors.push('工具名称不能为空');
  if (design.fields.length === 0) errors.push('至少需要一个字段');
  
  // 检查字段名唯一性
  const fieldNames = design.fields.map(f => f.name);
  const duplicates = fieldNames.filter((name, index) => fieldNames.indexOf(name) !== index);
  if (duplicates.length > 0) {
    errors.push(`字段名重复: ${duplicates.join(', ')}`);
  }
  
  // 检查必填字段是否有标签
  design.fields.forEach(field => {
    if (!field.label) errors.push(`字段 ${field.name} 缺少标签`);
  });
  
  return {
    valid: errors.length === 0,
    errors
  };
}
```

#### 8.1 组件结构

```
frontend/src/
├── components/
│   └── panel/
│       ├── RightPanel.vue          # 现有：右侧面板容器
│       ├── FormsTab.vue            # 新增：表单标签页
│       └── form/
│           ├── FormContainer.vue   # 表单容器（加载、状态管理）
│           ├── DynamicForm.vue       # 动态表单渲染器
│           ├── FormField.vue         # 字段渲染器（根据type分发）
│           ├── fields/               # 字段类型组件
│           │   ├── TextField.vue
│           │   ├── SelectField.vue
│           │   ├── DateField.vue
│           │   ├── FileField.vue
│           │   ├── UserPickerField.vue
│           │   └── ...
│           └── FormHistory.vue       # 历史表单列表
├── stores/
│   └── form.ts                     # 表单状态管理
├── api/
│   └── form.ts                     # 表单API
└── types/
    └── form.ts                     # 表单类型定义
```

#### 8.2 表单状态管理（Pinia Store）

```typescript
// stores/form.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useFormStore = defineStore('form', () => {
  // State
  const currentForm = ref<FormInstance | null>(null)
  const formHistory = ref<FormInstance[]>([])
  const isLoading = ref(false)
  const activeFormId = ref<string | null>(null)
  
  // Getters
  const hasActiveForm = computed(() => currentForm.value !== null)
  const activeForms = computed(() => 
    formHistory.value.filter(f => ['draft', 'submitting', 'processing'].includes(f.status))
  )
  const completedForms = computed(() =>
    formHistory.value.filter(f => ['completed', 'failed', 'cancelled'].includes(f.status))
  )
  
  // Actions
  
  // 打开新表单（由技能触发）
  async function openForm(templateId: string, expertId: string, initialData?: any) {
    isLoading.value = true
    try {
      const instance = await formApi.createInstance({
        template_id: templateId,
        expert_id: expertId,
        initial_data: initialData
      })
      currentForm.value = instance
      activeFormId.value = instance.id
      return instance
    } finally {
      isLoading.value = false
    }
  }
  
  // 加载已有表单
  async function loadForm(instanceId: string) {
    isLoading.value = true
    try {
      const instance = await formApi.getInstance(instanceId)
      currentForm.value = instance
      activeFormId.value = instance.id
      return instance
    } finally {
      isLoading.value = false
    }
  }
  
  // 更新表单数据（自动保存）
  async function updateFormData(formId: string, data: any) {
    await formApi.updateData(formId, data)
    if (currentForm.value?.id === formId) {
      currentForm.value.form_data = data
    }
  }
  
  // 提交表单
  async function submitForm(formId: string, data: any) {
    const result = await formApi.submit(formId, data)
    // 更新当前表单状态
    if (currentForm.value?.id === formId) {
      currentForm.value.status = result.status
      currentForm.value.ai_review = result.ai_review
    }
    // 添加到对话
    addFormMessageToChat(result)
    return result
  }
  
  // 关闭当前表单
  function closeForm() {
    currentForm.value = null
    activeFormId.value = null
  }
  
  // 加载表单历史
  async function loadFormHistory(params?: { status?: string; page?: number }) {
    const result = await formApi.listInstances(params)
    formHistory.value = result.items
    return result
  }
  
  // 在对话中添加表单提交消息
  function addFormMessageToChat(result: FormSubmitResult) {
    // 通过事件总线或全局状态触发消息添加
    // 显示："用户提交了请假申请" 的系统消息
  }
  
  return {
    currentForm,
    formHistory,
    isLoading,
    activeFormId,
    hasActiveForm,
    activeForms,
    completedForms,
    openForm,
    loadForm,
    updateFormData,
    submitForm,
    closeForm,
    loadFormHistory
  }
})
```

#### 8.3 表单标签页组件

```vue
<!-- components/panel/FormsTab.vue -->
<template>
  <div class="forms-tab">
    <!-- 当前表单区域 -->
    <div v-if="formStore.hasActiveForm" class="current-form-section">
      <div class="section-header">
        <span class="section-title">{{ formStore.currentForm?.template.name }}</span>
        <button class="btn-close" @click="closeForm" title="关闭表单">×</button>
      </div>
      <FormContainer 
        :instance="formStore.currentForm"
        @submit="handleSubmit"
        @cancel="closeForm"
      />
    </div>
    
    <!-- 空状态 -->
    <div v-else-if="!formStore.hasActiveForm && formStore.activeForms.length === 0" class="empty-state">
      <span class="empty-icon">📝</span>
      <p>暂无进行中的表单</p>
      <p class="hint">与专家对话时，需要填写表单时会自动显示</p>
    </div>
    
    <!-- 进行中的表单列表 -->
    <div v-if="formStore.activeForms.length > 0 && !formStore.hasActiveForm" class="active-forms-section">
      <div class="section-header">
        <span class="section-title">进行中的表单</span>
      </div>
      <div class="form-list">
        <div 
          v-for="form in formStore.activeForms" 
          :key="form.id"
          class="form-item"
          @click="resumeForm(form.id)"
        >
          <span class="form-icon">📝</span>
          <div class="form-info">
            <span class="form-name">{{ form.template.name }}</span>
            <span class="form-meta">创建于 {{ formatTime(form.created_at) }}</span>
          </div>
          <span class="form-status" :class="form.status">{{ statusText(form.status) }}</span>
        </div>
      </div>
    </div>
    
    <!-- 历史表单列表 -->
    <div class="history-section">
      <div class="section-header">
        <span class="section-title">历史记录</span>
        <button class="btn-refresh" @click="refreshHistory" :disabled="loading">
          <svg class="icon" :class="{ spinning: loading }" viewBox="0 0 24 24" width="14" height="14">
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
        </button>
      </div>
      <div class="form-list">
        <div 
          v-for="form in formStore.completedForms" 
          :key="form.id"
          class="form-item completed"
          @click="viewForm(form.id)"
        >
          <span class="form-icon">📋</span>
          <div class="form-info">
            <span class="form-name">{{ form.template.name }}</span>
            <span class="form-meta">
              {{ form.submitted_at ? formatTime(form.submitted_at) : formatTime(form.created_at) }}
            </span>
          </div>
          <span class="form-status" :class="form.status">{{ statusText(form.status) }}</span>
        </div>
      </div>
      <Pagination 
        v-if="pagination.pages > 1"
        :current-page="pagination.page"
        :total-pages="pagination.pages"
        :total="pagination.total"
        @change="handlePageChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useFormStore } from '@/stores/form'
import FormContainer from '../form/FormContainer.vue'
import Pagination from '../Pagination.vue'

const formStore = useFormStore()
const loading = ref(false)
const pagination = ref({ page: 1, size: 10, total: 0, pages: 0 })

onMounted(() => {
  loadHistory()
})

async function loadHistory(page = 1) {
  loading.value = true
  try {
    const result = await formStore.loadFormHistory({ page })
    pagination.value = {
      page: result.page,
      size: result.size,
      total: result.total,
      pages: result.pages
    }
  } finally {
    loading.value = false
  }
}

function closeForm() {
  formStore.closeForm()
}

function resumeForm(formId: string) {
  formStore.loadForm(formId)
}

function viewForm(formId: string) {
  // 查看已提交表单的详情（只读模式）
  formStore.loadForm(formId)
}

async function handleSubmit(data: any) {
  if (!formStore.currentForm) return
  await formStore.submitForm(formStore.currentForm.id, data)
}

function refreshHistory() {
  loadHistory(pagination.value.page)
}

function handlePageChange(page: number) {
  loadHistory(page)
}

function formatTime(time: string) {
  return new Date(time).toLocaleString()
}

function statusText(status: string) {
  const map: Record<string, string> = {
    draft: '草稿',
    submitting: '提交中',
    submitted: '已提交',
    processing: '处理中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消'
  }
  return map[status] || status
}
</script>
```

#### 8.4 动态表单渲染器

```vue
<!-- components/form/DynamicForm.vue -->
<template>
  <form class="dynamic-form" @submit.prevent="handleSubmit">
    <div class="form-fields" :class="layoutClass">
      <FormField
        v-for="field in visibleFields"
        :key="field.name"
        :field="field"
        :value="formData[field.name]"
        :error="errors[field.name]"
        @update:value="updateField(field.name, $event)"
      />
    </div>
    
    <div class="form-actions">
      <button 
        v-if="schema.actions.cancel"
        type="button"
        class="btn-cancel"
        @click="$emit('cancel')"
      >
        {{ schema.actions.cancel.label }}
      </button>
      
      <button 
        v-if="schema.actions.saveDraft?.enabled"
        type="button"
        class="btn-draft"
        @click="handleSaveDraft"
        :disabled="saving"
      >
        {{ saving ? '保存中...' : schema.actions.saveDraft.label }}
      </button>
      
      <button 
        type="submit"
        class="btn-submit"
        :disabled="submitting || !isValid"
      >
        {{ submitting ? '提交中...' : schema.actions.submit.label }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import FormField from './FormField.vue'

const props = defineProps<{
  schema: FormTemplateSchema
  initialData?: Record<string, any>
}>()

const emit = defineEmits<{
  submit: [data: Record<string, any>]
  'save-draft': [data: Record<string, any>]
  cancel: []
}>()

const formData = ref<Record<string, any>>({ ...props.initialData })
const errors = ref<Record<string, string>>({})
const submitting = ref(false)
const saving = ref(false)

// 计算可见字段（根据visibility条件）
const visibleFields = computed(() => {
  return props.schema.fields.filter(field => {
    if (!field.visibility) return true
    const { dependsOn, condition, value } = field.visibility
    const dependentValue = formData.value[dependsOn]
    switch (condition) {
      case 'equals': return dependentValue === value
      case 'notEquals': return dependentValue !== value
      case 'contains': return dependentValue?.includes?.(value)
      case 'greaterThan': return dependentValue > value
      case 'lessThan': return dependentValue < value
      default: return true
    }
  })
})

const layoutClass = computed(() => {
  const columns = props.schema.layout?.columns || 1
  return `layout-${columns}-col`
})

const isValid = computed(() => {
  return visibleFields.value.every(field => {
    if (field.required && !formData.value[field.name]) return false
    return true
  })
})

function updateField(name: string, value: any) {
  formData.value[name] = value
  // 清除该字段的错误
  delete errors.value[name]
}

async function handleSubmit() {
  if (!validate()) return
  
  submitting.value = true
  try {
    emit('submit', { ...formData.value })
  } finally {
    submitting.value = false
  }
}

async function handleSaveDraft() {
  saving.value = true
  try {
    emit('save-draft', { ...formData.value })
  } finally {
    saving.value = false
  }
}

function validate(): boolean {
  errors.value = {}
  let valid = true
  
  for (const field of visibleFields.value) {
    const value = formData.value[field.name]
    
    // 必填验证
    if (field.required && !value) {
      errors.value[field.name] = `${field.label}不能为空`
      valid = false
      continue
    }
    
    // 其他验证规则...
    if (field.validation && value) {
      const { min, max, minLength, maxLength, pattern } = field.validation
      
      if (min !== undefined && value < min) {
        errors.value[field.name] = `${field.label}不能小于${min}`
        valid = false
      }
      
      if (max !== undefined && value > max) {
        errors.value[field.name] = `${field.label}不能大于${max}`
        valid = false
      }
      
      if (minLength !== undefined && value.length < minLength) {
        errors.value[field.name] = `${field.label}至少${minLength}个字符`
        valid = false
      }
      
      if (maxLength !== undefined && value.length > maxLength) {
        errors.value[field.name] = `${field.label}最多${maxLength}个字符`
        valid = false
      }
      
      if (pattern && !new RegExp(pattern).test(value)) {
        errors.value[field.name] = `${field.label}格式不正确`
        valid = false
      }
    }
  }
  
  return valid
}
</script>
```

### 9. 与现有系统的集成

#### 9.1 RightPanel 集成

```typescript
// stores/panel.ts - 添加 forms Tab

export type TabId = 'expert' | 'topics' | 'tasks' | 'assistants' | 'debug' | 'skills' | 'forms'

// visibleTabs 中添加
const visibleTabs = computed<Tab[]>(() => {
  const tabs: Tab[] = [
    { id: 'expert', label: t('panel.expert'), icon: '👤' },
    { id: 'topics', label: t('panel.topics'), icon: '💬' },
    { id: 'tasks', label: t('panel.tasks'), icon: '📁' },
    { id: 'assistants', label: t('panel.assistants'), icon: '🤖' },
    { id: 'forms', label: t('panel.forms') || '表单', icon: '📝' }, // 新增
    { id: 'skills', label: t('panel.skillsDirectory'), icon: '🛠️', skillManagerOnly: true },
    { id: 'debug', label: t('panel.debug'), icon: '🔧', adminOnly: true },
  ]
  // ...
})
```

#### 9.2 消息流集成

```typescript
// 当表单提交后，在对话中显示系统消息

interface FormSubmitMessage {
  type: 'form_submit';
  form_instance_id: string;
  form_name: string;
  status: 'submitted' | 'completed' | 'failed';
  summary: string; // 表单摘要，如"年假3天，事由：探亲"
  ai_review?: {
    status: 'approved' | 'rejected' | 'modified';
    comment: string;
  };
}

// 在 ChatWindow 中渲染
// 显示为可折叠的卡片：
// ┌─────────────────────────────────────┐
// │ 📝 请假申请单 - 已提交               │
// │ 年假3天 (2024-01-15 至 2024-01-17)  │
// │ 事由：回家探亲                       │
// │ [查看详情] [重新编辑]               │
// └─────────────────────────────────────┘
```

#### 9.3 SSE 事件集成

```typescript
// 表单相关 SSE 事件

interface FormOpenEvent {
  event: 'form.open';
  data: {
    form_instance_id: string;
    template: FormTemplate;
    initial_data?: Record<string, any>;
  };
}

interface FormUpdateEvent {
  event: 'form.update';
  data: {
    form_instance_id: string;
    status: FormStatus;
    ai_review?: AIReviewResult;
    message?: string;
  };
}

// 前端监听并自动切换右侧面板到表单Tab
```

### 10. 实现阶段规划

#### 10.1 第一阶段：基础表单（MVP）

**目标**：实现基本的表单呈现和提交功能

**任务清单**：
1. 数据库表创建（form_templates, form_instances）
2. 后端 API 实现（模板CRUD、实例管理）
3. 前端基础组件（DynamicForm、FormField）
4. 支持字段类型：text、textarea、number、date、select
5. 表单提交和AI审核流程
6. 右侧面板集成（FormsTab）

**时间**：2-3周

#### 10.2 第二阶段：增强功能

**目标**：完善表单功能和用户体验

**任务清单**：
1. 更多字段类型（file、userpicker、richtext、json）
2. 字段联动（visibility条件）
3. 表单草稿自动保存
4. 表单历史查询
5. 表单消息卡片在对话中的渲染
6. 数据源集成（API、Skill动态获取）

**时间**：2周

#### 10.3 第三阶段：高级特性

**目标**：支持复杂场景和企业级需求

**任务清单**：
1. 多步骤表单（wizard）
2. 表单模板可视化编辑器
3. 表单权限控制（谁可以填写、谁可以审批）
4. 表单数据导出
5. 表单与工作流集成

**时间**：3-4周

### 11. 示例：请假申请完整流程

```
用户: 我想请3天年假

AI: 我来帮您创建请假申请。
    [调用 hrm.create_leave_request 工具]
    
系统: 在右侧面板打开"请假申请单"表单
      预填充：请假类型=年假，天数=3
      
用户: [在表单中填写]
      - 开始日期: 2024-01-15
      - 结束日期: 2024-01-17
      - 事由: 回家探亲
      - 审批人: 张经理
      [点击提交]

系统: [显示提交中状态]
      [AI审核中...]
      
AI: 审核通过。请假申请已提交给张经理审批。
    申请单号：LEAVE-2024-0015
    
系统: 在对话中显示系统消息：
      "📝 请假申请单 - 已提交
       年假3天 (2024-01-15 至 2024-01-17)
       审批人：张经理"
       
用户: [可以在FormsTab查看申请状态]
```

### 12. 扩展：报表与数据展示场景

表单系统的设计可以扩展到**数据展示和报表**场景。两者的核心区别：

| 场景 | 数据流向 | 用户交互 | 典型用途 |
|------|---------|---------|---------|
| **表单 (Form)** | 用户 → 外部系统 | 填写、提交 | 请假申请、报销、数据录入 |
| **报表 (Report)** | 外部系统 → 用户 | 查看、筛选、导出 | 销售报表、库存查询、数据可视化 |

#### 12.1 统一架构：Panel Content 系统

将表单和报表统一抽象为 **"右侧面板内容" (Panel Content)**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     右侧面板内容系统 (Panel Content System)                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │
│   │   Form Content  │    │  Report Content │    │  Custom Content │      │
│   │   (表单填写)     │    │   (报表展示)    │    │   (自定义视图)   │      │
│   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘      │
│            │                      │                      │               │
│            └──────────────────────┼──────────────────────┘               │
│                                   │                                    │
│                          ┌────────▼────────┐                           │
│                          │  Content Loader │                           │
│                          │  (内容加载器)   │                           │
│                          └────────┬────────┘                           │
│                                   │                                    │
│                          ┌────────▼────────┐                           │
│                          │  Data Fetcher   │                           │
│                          │  (数据获取器)   │                           │
│                          │  • 调用外部API   │                           │
│                          │  • 凭证注入     │                           │
│                          │  • 数据转换     │                           │
│                          └─────────────────┘                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 12.2 报表模板设计

```sql
-- =============================================
-- 报表模板定义表（与表单模板类似结构）
-- =============================================
CREATE TABLE report_templates (
    id VARCHAR(32) PRIMARY KEY,
    skill_id VARCHAR(32) NOT NULL COMMENT '所属技能ID',
    tool_name VARCHAR(64) NOT NULL COMMENT '工具名称（如 show_sales_report）',
    name VARCHAR(128) NOT NULL COMMENT '报表显示名称',
    description TEXT COMMENT '报表描述',
    
    -- 报表类型
    type ENUM('table', 'chart', 'dashboard', 'custom') NOT NULL,
    
    -- 数据源配置（从哪获取数据）
    data_source JSON NOT NULL COMMENT '数据源配置',
    -- 示例：
    -- {
    --   "type": "api",
    --   "endpoint": "/api/erp/sales-data",
    --   "method": "POST",
    --   "params": {
    --     "start_date": "{start_date}",
    --     "end_date": "{end_date}",
    --     "department": "{department}"
    --   },
    --   "refresh_interval": 300  -- 自动刷新间隔（秒）
    -- }
    
    -- 报表结构定义
    schema JSON NOT NULL COMMENT '报表结构定义',
    -- 示例（表格报表）：
    -- {
    --   "type": "table",
    --   "columns": [
    --     { "field": "product_name", "label": "产品名称", "width": 200 },
    --     { "field": "sales_qty", "label": "销售数量", "align": "right", "format": "number" },
    --     { "field": "sales_amount", "label": "销售金额", "align": "right", "format": "currency" },
    --     { "field": "sales_date", "label": "日期", "format": "date" }
    --   ],
    --   "filters": [
    --     { "name": "start_date", "label": "开始日期", "type": "date", "required": true },
    --     { "name": "end_date", "label": "结束日期", "type": "date", "required": true },
    --     { "name": "department", "label": "部门", "type": "select", "data_source": "departments" }
    --   ],
    --   "pagination": { "enabled": true, "page_size": 20 },
    --   "actions": [
    --     { "type": "export", "label": "导出Excel", "format": "xlsx" },
    --     { "type": "export", "label": "导出PDF", "format": "pdf" },
    --     { "type": "refresh", "label": "刷新数据" }
    --   ]
    -- }
    
    -- 图表配置（如果是图表类型）
    chart_config JSON COMMENT '图表配置',
    -- 示例：
    -- {
    --   "type": "line",  // line, bar, pie, scatter
    --   "x_axis": { "field": "date", "label": "日期" },
    --   "y_axis": { "field": "amount", "label": "销售额" },
    --   "series": [
    --     { "field": "online_sales", "label": "线上销售", "color": "#1890ff" },
    --     { "field": "offline_sales", "label": "线下销售", "color": "#52c41a" }
    --   ]
    -- }
    
    -- 目标系统配置（从哪获取数据）
    destination_id VARCHAR(32) COMMENT '关联的目标系统ID',
    
    -- 缓存配置
    cache_config JSON COMMENT '数据缓存配置',
    -- {
    --   "enabled": true,
    --   "ttl": 300,  -- 缓存时间（秒）
    --   "key_pattern": "report:{template_id}:{user_id}:{hash(params)}"
    -- }
    
    is_active BIT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_skill_tool (skill_id, tool_name),
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
    FOREIGN KEY (destination_id) REFERENCES form_destinations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报表模板定义表';

-- =============================================
-- 报表实例表（记录用户查看的报表）
-- =============================================
CREATE TABLE report_instances (
    id VARCHAR(32) PRIMARY KEY,
    template_id VARCHAR(32) NOT NULL COMMENT '报表模板ID',
    user_id VARCHAR(32) NOT NULL COMMENT '查看用户ID',
    expert_id VARCHAR(32) NOT NULL COMMENT '所属专家ID',
    topic_id VARCHAR(32) COMMENT '关联话题ID',
    
    -- 查询参数
    query_params JSON COMMENT '用户输入的查询参数',
    
    -- 数据快照（可选，用于离线查看）
    data_snapshot JSON COMMENT '数据快照',
    snapshot_at TIMESTAMP NULL COMMENT '快照时间',
    
    -- 状态
    status ENUM('loading', 'loaded', 'error', 'expired') DEFAULT 'loading',
    error_message TEXT COMMENT '错误信息',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_user_template (user_id, template_id),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (template_id) REFERENCES report_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='报表实例表';
```

#### 12.3 报表与表单的对比

```typescript
// ============================================
// 表单 vs 报表：核心差异
// ============================================

// 表单：收集用户输入，提交到外部系统
interface FormTemplate {
  type: 'form';
  schema: {
    fields: FormField[];        // 输入字段
    actions: {
      submit: { label: string; validate: boolean; };
      cancel?: { label: string; };
    };
  };
  destination_id: string;       // 数据提交目标
  field_mapping: Record<string, FieldMappingRule>;  // 字段映射
  ai_review_config?: AIReviewConfig;  // AI审核
}

// 报表：从外部系统获取数据，展示给用户
interface ReportTemplate {
  type: 'report';
  schema: {
    type: 'table' | 'chart' | 'dashboard';
    columns?: ReportColumn[];   // 表格列定义
    filters?: FilterField[];     // 筛选条件（类似表单字段）
    chart_config?: ChartConfig;  // 图表配置
  };
  data_source: {
    type: 'api' | 'skill' | 'database';
    destination_id: string;      // 数据来源目标
    endpoint: string;
    params: Record<string, any>; // 查询参数模板
    refresh_interval?: number;   // 自动刷新
  };
  cache_config?: CacheConfig;    // 数据缓存
}

// 共同点：都使用 destination_id 和凭证系统
// 差异点：数据流向相反，交互方式不同
```

#### 12.4 报表渲染组件

```vue
<!-- components/panel/report/ReportContainer.vue -->
<template>
  <div class="report-container">
    <!-- 筛选条件区（类似表单） -->
    <div v-if="template.schema.filters?.length" class="report-filters">
      <DynamicForm
        :schema="{ fields: template.schema.filters, actions: { submit: { label: '查询', validate: true } } }"
        @submit="handleQuery"
      />
    </div>
    
    <!-- 数据展示区 -->
    <div class="report-content">
      <!-- 加载状态 -->
      <div v-if="loading" class="loading-state">
        <LoadingSpinner />
        <p>正在加载数据...</p>
      </div>
      
      <!-- 错误状态 -->
      <div v-else-if="error" class="error-state">
        <ErrorIcon />
        <p>{{ error }}</p>
        <button @click="refresh">重试</button>
      </div>
      
      <!-- 表格报表 -->
      <DataTable
        v-else-if="template.schema.type === 'table'"
        :columns="template.schema.columns"
        :data="reportData"
        :pagination="template.schema.pagination"
        @page-change="handlePageChange"
      />
      
      <!-- 图表报表 -->
      <ChartView
        v-else-if="template.schema.type === 'chart'"
        :config="template.chart_config"
        :data="reportData"
      />
      
      <!-- 仪表盘 -->
      <DashboardView
        v-else-if="template.schema.type === 'dashboard'"
        :widgets="template.schema.widgets"
        :data="reportData"
      />
    </div>
    
    <!-- 操作按钮 -->
    <div class="report-actions">
      <button 
        v-for="action in template.schema.actions" 
        :key="action.type"
        @click="handleAction(action)"
      >
        {{ action.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import DynamicForm from '../form/DynamicForm.vue'
import DataTable from './DataTable.vue'
import ChartView from './ChartView.vue'
import DashboardView from './DashboardView.vue'

const props = defineProps<{
  instance: ReportInstance
}>()

const loading = ref(false)
const error = ref<string | null>(null)
const reportData = ref<any[]>([])

onMounted(() => {
  loadData()
})

async function loadData(params?: Record<string, any>) {
  loading.value = true
  error.value = null
  
  try {
    // 调用后端API获取数据
    const result = await reportApi.fetchData(props.instance.id, params)
    reportData.value = result.data
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function handleQuery(formData: Record<string, any>) {
  loadData(formData)
}

function handleAction(action: ReportAction) {
  switch (action.type) {
    case 'export':
      exportReport(action.format)
      break
    case 'refresh':
      refresh()
      break
  }
}

async function exportReport(format: 'xlsx' | 'pdf' | 'csv') {
  await reportApi.export(props.instance.id, format)
}

function refresh() {
  loadData()
}
</script>
```

#### 12.5 技能集成示例（ERP销售报表）

```markdown
---
name: erp
description: "企业ERP系统集成"
---

## 工具列表

| 工具 | 说明 | 类型 |
|---|---|---|
| show_sales_report | 查看销售报表 | 报表 |
| create_purchase_order | 创建采购订单 | 表单 |
| query_inventory | 查询库存 | 报表 |

## 报表模板配置

### show_sales_report

```yaml
report_template:
  name: "销售报表"
  description: "查看指定时间段的销售数据"
  type: "table"  # table, chart, dashboard
  
  # 筛选条件（用户输入）
  schema:
    filters:
      - name: start_date
        label: "开始日期"
        type: date
        required: true
        default_value: "{today-30d}"
      
      - name: end_date
        label: "结束日期"
        type: date
        required: true
        default_value: "{today}"
      
      - name: department
        label: "销售部门"
        type: select
        data_source:
          type: api
          endpoint: "/api/erp/departments"
      
      - name: product_category
        label: "产品类别"
        type: multiselect
        required: false
    
    # 表格列定义
    columns:
      - field: order_no
        label: "订单号"
        width: 150
        fixed: left
      
      - field: product_name
        label: "产品名称"
        width: 200
      
      - field: sales_qty
        label: "销售数量"
        align: right
        format: number
        agg: sum  # 可聚合
      
      - field: sales_amount
        label: "销售金额"
        align: right
        format: currency
        agg: sum
        style:
          color: "{value > 10000 ? 'green' : 'inherit'}"
      
      - field: sales_date
        label: "销售日期"
        format: date
        width: 120
      
      - field: salesperson
        label: "销售员"
        width: 100
    
    # 分页配置
    pagination:
      enabled: true
      page_size: 20
      page_size_options: [10, 20, 50, 100]
    
    # 操作按钮
    actions:
      - type: export
        label: "导出Excel"
        format: xlsx
      
      - type: export
        label: "导出PDF"
        format: pdf
      
      - type: refresh
        label: "刷新数据"
  
  # 数据源配置
  data_source:
    type: api
    destination_id: "dest_erp_prod"  # 引用目标系统
    endpoint: "/api/sales/report"
    method: POST
    params_mapping:  # 筛选参数映射到API参数
      start_date: startDate
      end_date: endDate
      department: deptCode
      product_category: categories
    
    # 自动刷新（可选）
    refresh_interval: 300  # 5分钟
  
  # 缓存配置
  cache_config:
    enabled: true
    ttl: 60  # 1分钟缓存
```

#### 12.6 后端数据获取服务

```typescript
// services/report/ReportDataService.ts

export class ReportDataService {
  constructor(
    private reportTemplateRepo: ReportTemplateRepository,
    private credentialService: SecureCredentialService,
    private destinationDispatcher: DestinationDispatcher,
    private cacheService: CacheService
  ) {}
  
  /**
   * 获取报表数据
   */
  async fetchReportData(
    templateId: string,
    queryParams: Record<string, any>,
    userContext: UserContext
  ): Promise<ReportDataResult> {
    const template = await this.reportTemplateRepo.findById(templateId)
    
    // 1. 检查缓存
    const cacheKey = this.buildCacheKey(templateId, queryParams, userContext)
    if (template.cache_config?.enabled) {
      const cached = await this.cacheService.get(cacheKey)
      if (cached) {
        return { data: cached, from_cache: true }
      }
    }
    
    // 2. 获取目标系统配置和凭证
    const destination = await this.reportTemplateRepo.getDestination(template.destination_id)
    const credential = destination.credential_id
      ? await this.credentialService.getCredential(destination.credential_id)
      : null
    
    // 3. 转换查询参数
    const apiParams = this.transformQueryParams(queryParams, template.data_source.params_mapping)
    
    // 4. 调用目标系统API获取数据
    const response = await this.destinationDispatcher.fetch({
      destination,
      credential,
      params: apiParams,
      endpoint: template.data_source.endpoint,
      method: template.data_source.method
    })
    
    // 5. 数据转换（字段映射、格式转换等）
    const transformedData = this.transformReportData(response.data, template.schema.columns)
    
    // 6. 写入缓存
    if (template.cache_config?.enabled) {
      await this.cacheService.set(
        cacheKey,
        transformedData,
        template.cache_config.ttl
      )
    }
    
    return {
      data: transformedData,
      total: response.total || transformedData.length,
      from_cache: false
    }
  }
  
  /**
   * 导出报表
   */
  async exportReport(
    templateId: string,
    queryParams: Record<string, any>,
    format: 'xlsx' | 'pdf' | 'csv',
    userContext: UserContext
  ): Promise<Buffer> {
    // 1. 获取数据
    const { data } = await this.fetchReportData(templateId, queryParams, userContext)
    
    // 2. 根据格式导出
    switch (format) {
      case 'xlsx':
        return this.exportToExcel(data, templateId)
      case 'pdf':
        return this.exportToPDF(data, templateId)
      case 'csv':
        return this.exportToCSV(data, templateId)
      default:
        throw new Error(`Unsupported export format: ${format}`)
    }
  }
}
```

#### 12.7 统一面板内容管理

```typescript
// stores/panelContent.ts - 统一的面板内容管理

export const usePanelContentStore = defineStore('panelContent', () => {
  // 当前显示的内容
  const currentContent = ref<PanelContent | null>(null)
  
  // 内容历史
  const contentHistory = ref<PanelContent[]>([])
  
  // 打开表单
  async function openForm(templateId: string, expertId: string, initialData?: any) {
    const instance = await formApi.createInstance({ template_id: templateId, expert_id: expertId })
    currentContent.value = {
      type: 'form',
      id: instance.id,
      title: instance.template.name,
      data: instance
    }
    // 切换到表单标签页
    panelStore.switchTab('forms')
  }
  
  // 打开报表
  async function openReport(templateId: string, expertId: string, queryParams?: any) {
    const instance = await reportApi.createInstance({ 
      template_id: templateId, 
      expert_id: expertId,
      query_params: queryParams 
    })
    currentContent.value = {
      type: 'report',
      id: instance.id,
      title: instance.template.name,
      data: instance
    }
    // 切换到报表标签页（或复用forms标签页）
    panelStore.switchTab('forms')
  }
  
  // 统一的关闭方法
  function closeContent() {
    currentContent.value = null
  }
  
  return {
    currentContent,
    contentHistory,
    openForm,
    openReport,
    closeContent
  }
})

// 面板内容类型
interface PanelContent {
  type: 'form' | 'report' | 'custom';
  id: string;
  title: string;
  data: FormInstance | ReportInstance | any;
}
```

#### 12.8 场景对比总结

| 功能 | 表单场景 | 报表场景 |
|------|---------|---------|
| **数据流向** | 用户输入 → 后端 → 外部系统 | 外部系统 → 后端 → 前端展示 |
| **核心组件** | `DynamicForm.vue` | `ReportContainer.vue` |
| **数据库表** | `form_templates`, `form_instances` | `report_templates`, `report_instances` |
| **后端服务** | `FormSubmissionService` | `ReportDataService` |
| **用户交互** | 填写、验证、提交 | 筛选、查看、导出 |
| **AI审核** | 提交前审核 | 数据异常检测（可选） |
| **凭证使用** | 提交时注入 | 查询时注入 |
| **缓存策略** | 通常不缓存 | 建议缓存 |

#### 12.9 扩展性设计

未来还可以支持更多面板内容类型：

```typescript
// 可能的扩展类型
type PanelContentType = 
  | 'form'           // 表单填写
  | 'report'         // 数据报表
  | 'terminal'       // SSH终端（erix-ssh技能）
  | 'document'       // 文档预览/编辑
  | 'kanban'         // 看板视图
  | 'calendar'       // 日历视图
  | 'chat'           // 独立聊天窗口
  | 'custom';        // 自定义Vue组件

// 所有类型共享：
// - 目标系统配置 (form_destinations)
// - 凭证管理 (secure_credentials)
// - 右侧面板容器 (RightPanel)
// - 数据获取和转换逻辑
```

### 13. 扩展：AI自动填充表单

当AI在与用户对话中已经获取了表单相关信息时，可以自动填充表单字段，减少用户重复输入。

#### 13.1 场景示例

```
用户: 我想请3天年假，从下周一开始

AI: 好的，我来帮您创建请假申请。
    [分析对话提取信息]
    - 请假类型: 年假 (leave_type = "annual")
    - 请假天数: 3天 (days = 3)
    - 开始日期: 下周一 = 2024-01-15 (start_date = "2024-01-15")
    - 结束日期: 推算 = 2024-01-17 (end_date = "2024-01-17")
    
    [调用 create_leave_request 工具，携带提取的数据]
    
系统: 打开表单，预填充已提取的字段
      用户只需填写剩余字段（事由、审批人）
```

#### 13.2 架构设计

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI自动填充流程                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  用户对话                                                                │
│     │                                                                   │
│     ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. 意图识别 + 实体提取 (Intent Recognition & Entity Extraction) │   │
│  │     • LLM分析用户意图（想请假、想报销、想查询）                    │   │
│  │     • 提取关键实体（日期、数量、类型、人员等）                    │   │
│  │     • 置信度评估                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│     │                                                                   │
│     ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  2. 字段映射 (Field Mapping)                                     │   │
│  │     • 将提取的实体映射到表单字段                                  │   │
│  │     • 数据格式转换（如"下周一" → "2024-01-15"）                   │   │
│  │     • 验证字段值是否合法                                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│     │                                                                   │
│     ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  3. 表单预填充 (Form Pre-fill)                                   │   │
│  │     • 生成 initial_data                                          │   │
│  │     • 标记自动填充的字段（显示AI填充标识）                        │   │
│  │     • 保留置信度信息                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│     │                                                                   │
│     ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  4. 用户确认/修改 (User Confirmation)                            │   │
│  │     • 用户查看预填充内容                                          │   │
│  │     • 可修改AI填充的字段                                          │   │
│  │     • 填写剩余空白字段                                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 13.3 数据模型扩展

```typescript
// 表单模板增加AI填充配置
interface FormTemplate {
  // ... 原有字段
  
  // AI自动填充配置
  ai_fill_config?: {
    enabled: boolean;  // 是否启用AI自动填充
    
    // 字段提取规则
    field_extraction: FieldExtractionRule[];
    
    // 置信度阈值（低于此值不自动填充）
    confidence_threshold: number;
    
    // 是否允许AI填充后自动提交（高风险）
    auto_submit: boolean;
    
    // 填充后提示模板
    fill_notification_template?: string;
  };
}

// 字段提取规则
interface FieldExtractionRule {
  field_name: string;           // 表单字段名
  
  // 提取方式
  extraction: {
    type: 'entity' | 'pattern' | 'llm' | 'context';
    
    // entity: 从实体提取（如DATE, PERSON, NUMBER）
    entity_type?: string;
    
    // pattern: 正则匹配
    pattern?: string;
    pattern_group?: number;
    
    // llm: LLM直接提取
    llm_prompt?: string;
    
    // context: 从上下文获取（如user_name, current_date）
    context_key?: string;
  };
  
  // 数据转换
  transform?: {
    type: 'date' | 'number' | 'mapping' | 'custom';
    
    // date: 自然语言日期转换
    date_config?: {
      base_date?: 'today' | 'context';
      format: 'YYYY-MM-DD' | 'timestamp' | 'iso';
    };
    
    // number: 数字提取
    number_config?: {
      unit?: string;  // 如 "天", "元"
      multiplier?: number;
    };
    
    // mapping: 值映射
    value_mapping?: Record<string, string>;
    // 如: { "年假": "annual", "病假": "sick" }
    
    // custom: 自定义转换函数
    custom_function?: string;
  };
  
  // 验证规则
  validation?: {
    required: boolean;
    min?: number;
    max?: number;
    pattern?: string;
  };
  
  // 是否必须人工确认（即使AI填充了）
  require_confirmation: boolean;
}

// 表单实例增加AI填充信息
interface FormInstance {
  // ... 原有字段
  
  // AI填充记录
  ai_filled_fields?: AIFilledField[];
}

interface AIFilledField {
  field_name: string;
  original_value: string;      // 从对话提取的原始值
  filled_value: any;          // 填充到表单的值
  confidence: number;          // 置信度 0-1
  extraction_method: string;  // 提取方式
  timestamp: string;
  user_modified: boolean;      // 用户是否修改过
}
```

#### 13.4 SKILL.md 配置示例

```yaml
form_template:
  name: "请假申请单"
  
  # AI自动填充配置
  ai_fill_config:
    enabled: true
    confidence_threshold: 0.7  # 置信度>0.7才自动填充
    auto_submit: false         # 不自动提交，需用户确认
    fill_notification_template: |
      我已从对话中提取到以下信息：
      {filled_fields_summary}
      请确认并补充剩余信息。
    
    field_extraction:
      # 请假类型提取
      - field_name: leave_type
        extraction:
          type: pattern
          pattern: "(年假|病假|事假|婚假|产假|丧假)"
        transform:
          type: mapping
          value_mapping:
            "年假": "annual"
            "病假": "sick"
            "事假": "personal"
            "婚假": "marriage"
            "产假": "maternity"
            "丧假": "bereavement"
        require_confirmation: false
      
      # 请假天数提取
      - field_name: days
        extraction:
          type: pattern
          pattern: "(\\d+(?:\\.\\d+)?)\\s*天"
          pattern_group: 1
        transform:
          type: number
        validation:
          min: 0.5
          max: 30
        require_confirmation: true  # 天数需要确认
      
      # 开始日期提取（自然语言日期）
      - field_name: start_date
        extraction:
          type: entity
          entity_type: "DATE"
        transform:
          type: date
          date_config:
            base_date: "today"
            format: "YYYY-MM-DD"
        require_confirmation: true
      
      # 结束日期计算（根据开始日期+天数）
      - field_name: end_date
        extraction:
          type: context
          context_key: "calculated"  # 由系统计算
        transform:
          type: custom
          custom_function: "calculate_end_date"
        require_confirmation: false
      
      # 申请人（从上下文获取当前用户）
      - field_name: applicant
        extraction:
          type: context
          context_key: "user_name"
        require_confirmation: false
      
      # 部门（从上下文获取）
      - field_name: department
        extraction:
          type: context
          context_key: "user_department"
        require_confirmation: false
      
      # 事由（LLM提取）
      - field_name: reason
        extraction:
          type: llm
          llm_prompt: |
            从以下对话中提取请假事由：
            {conversation}
            只返回事由内容，不要解释。
        require_confirmation: true  # 事由通常需要用户确认
```

#### 13.5 后端AI填充服务

```typescript
// services/form/AIFillService.ts

export class AIFillService {
  constructor(
    private llmService: LLMService,
    private entityExtractionService: EntityExtractionService,
    private dateParserService: DateParserService
  ) {}
  
  /**
   * 从对话中提取表单数据
   */
  async extractFormData(
    conversation: ConversationMessage[],
    formTemplate: FormTemplate,
    userContext: UserContext
  ): Promise<FormFillResult> {
    const filledFields: AIFilledField[] = [];
    const formData: Record<string, any> = {};
    
    for (const rule of formTemplate.ai_fill_config?.field_extraction || []) {
      try {
        const extraction = await this.extractField(
          conversation,
          rule,
          userContext
        );
        
        if (extraction && extraction.confidence >= (formTemplate.ai_fill_config?.confidence_threshold || 0.7)) {
          // 数据转换
          const transformedValue = await this.transformValue(
            extraction.value,
            rule.transform
          );
          
          // 验证
          if (this.validateValue(transformedValue, rule.validation)) {
            formData[rule.field_name] = transformedValue;
            filledFields.push({
              field_name: rule.field_name,
              original_value: extraction.original_value,
              filled_value: transformedValue,
              confidence: extraction.confidence,
              extraction_method: rule.extraction.type,
              timestamp: new Date().toISOString(),
              user_modified: false
            });
          }
        }
      } catch (error) {
        console.warn(`Failed to extract field ${rule.field_name}:`, error);
      }
    }
    
    return {
      form_data: formData,
      filled_fields: filledFields,
      fill_rate: filledFields.length / formTemplate.schema.fields.length,
      notification: this.generateFillNotification(filledFields, formTemplate)
    };
  }
  
  /**
   * 提取单个字段
   */
  private async extractField(
    conversation: ConversationMessage[],
    rule: FieldExtractionRule,
    userContext: UserContext
  ): Promise<{ value: any; original_value: string; confidence: number } | null> {
    const text = conversation.map(m => m.content).join('\n');
    
    switch (rule.extraction.type) {
      case 'entity':
        return this.entityExtractionService.extract(text, rule.extraction.entity_type!);
      
      case 'pattern':
        const match = text.match(new RegExp(rule.extraction.pattern!, 'i'));
        if (match) {
          return {
            value: match[rule.extraction.pattern_group || 0],
            original_value: match[0],
            confidence: 0.9
          };
        }
        return null;
      
      case 'llm':
        const prompt = rule.extraction.llm_prompt!.replace('{conversation}', text);
        const response = await this.llmService.chat({
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1
        });
        return {
          value: response.content.trim(),
          original_value: response.content.trim(),
          confidence: 0.8  // LLM提取默认置信度
        };
      
      case 'context':
        const contextValue = this.getContextValue(rule.extraction.context_key!, userContext);
        if (contextValue) {
          return {
            value: contextValue,
            original_value: String(contextValue),
            confidence: 1.0  // 上下文值置信度100%
          };
        }
        return null;
      
      default:
        return null;
    }
  }
  
  /**
   * 数据转换
   */
  private async transformValue(
    value: any,
    transform?: FieldTransform
  ): Promise<any> {
    if (!transform) return value;
    
    switch (transform.type) {
      case 'date':
        return this.dateParserService.parse(value, transform.date_config);
      
      case 'number':
        const num = parseFloat(value);
        if (transform.number_config?.unit && value.includes(transform.number_config.unit)) {
          // 已包含单位，直接返回
        }
        return transform.number_config?.multiplier ? num * transform.number_config.multiplier : num;
      
      case 'mapping':
        return transform.value_mapping?.[value] || value;
      
      case 'custom':
        // 调用自定义转换函数
        return this.callCustomTransform(transform.custom_function!, value);
      
      default:
        return value;
    }
  }
  
  /**
   * 生成填充通知
   */
  private generateFillNotification(
    filledFields: AIFilledField[],
    template: FormTemplate
  ): string {
    const template_str = template.ai_fill_config?.fill_notification_template;
    if (!template_str) return '';
    
    const summary = filledFields.map(f => 
      `- ${f.field_name}: ${f.filled_value} (置信度: ${(f.confidence * 100).toFixed(0)}%)`
    ).join('\n');
    
    return template_str.replace('{filled_fields_summary}', summary);
  }
}
```

#### 13.6 前端展示AI填充字段

```vue
<!-- components/form/FormField.vue - 显示AI填充标识 -->
<template>
  <div class="form-field" :class="{ 'ai-filled': isAIFilled }">
    <label class="field-label">
      {{ field.label }}
      <span v-if="isAIFilled" class="ai-badge" title="AI自动填充">
        🤖 AI
      </span>
      <span v-if="field.required" class="required">*</span>
    </label>
    
    <div class="field-input-wrapper">
      <!-- 字段输入组件 -->
      <component
        :is="fieldComponent"
        v-model="fieldValue"
        :field="field"
        @change="handleChange"
      />
      
      <!-- AI填充提示和操作 -->
      <div v-if="isAIFilled && !userModified" class="ai-fill-actions">
        <span class="ai-fill-hint">
          从对话提取 (置信度: {{ (aiFillInfo.confidence * 100).toFixed(0) }}%)
        </span>
        <button class="btn-accept" @click="acceptAIFill">确认</button>
        <button class="btn-modify" @click="modifyAIFill">修改</button>
      </div>
    </div>
    
    <span v-if="error" class="field-error">{{ error }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  field: FormField;
  value: any;
  aiFillInfo?: AIFilledField;  // AI填充信息
  error?: string;
}>()

const emit = defineEmits(['update:value', 'accept-ai', 'modify-ai'])

const fieldValue = computed({
  get: () => props.value,
  set: (val) => emit('update:value', val)
})

const isAIFilled = computed(() => !!props.aiFillInfo)
const userModified = computed(() => props.aiFillInfo?.user_modified || false)

function acceptAIFill() {
  emit('accept-ai', props.field.name)
}

function modifyAIFill() {
  emit('modify-ai', props.field.name)
}

function handleChange() {
  if (isAIFilled.value && !userModified.value) {
    // 用户修改了AI填充的值，标记为已修改
    emit('modify-ai', props.field.name)
  }
}
</script>

<style scoped>
.form-field.ai-filled {
  background: rgba(24, 144, 255, 0.05);
  border-left: 3px solid #1890ff;
  padding-left: 12px;
}

.ai-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #1890ff;
  color: white;
  border-radius: 4px;
  font-size: 12px;
  margin-left: 8px;
}

.ai-fill-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
}

.ai-fill-hint {
  color: #1890ff;
}

.btn-accept, .btn-modify {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.btn-accept {
  background: #52c41a;
  color: white;
  border: none;
}

.btn-modify {
  background: white;
  color: #666;
  border: 1px solid #d9d9d9;
}
</style>
```

#### 13.7 完整流程示例

```
对话历史：
─────────────────────────────────────────
用户: 我想请3天年假，从下周一开始，因为家里有事
AI: 好的，我来帮您创建请假申请。
─────────────────────────────────────────

AI处理过程：
1. 意图识别: "create_leave_request" (置信度: 0.95)
2. 实体提取:
   - "3天" → days = 3 (置信度: 0.95)
   - "年假" → leave_type = "annual" (置信度: 0.98)
   - "下周一" → start_date = "2024-01-15" (置信度: 0.85)
   - "家里有事" → reason = "家里有事" (置信度: 0.75)
3. 计算字段:
   - end_date = start_date + 3天 = "2024-01-17"
4. 上下文字段:
   - applicant = "张三" (当前用户)
   - department = "技术部" (用户部门)

生成的 initial_data:
{
  "leave_type": "annual",
  "days": 3,
  "start_date": "2024-01-15",
  "end_date": "2024-01-17",
  "reason": "家里有事",
  "applicant": "张三",
  "department": "技术部"
}

表单呈现:
┌─────────────────────────────────────┐
│ 请假申请单                           │
├─────────────────────────────────────┤
│ 请假类型: [年假 🤖]                 │  ← AI填充，高置信度
│ 开始日期: [2024-01-15 🤖]            │  ← AI填充，需确认
│ 结束日期: [2024-01-17 🤖]            │  ← AI计算
│ 请假天数: [3 🤖]                     │  ← AI填充，需确认
│ 事由: [家里有事 🤖]                  │  ← AI填充，需确认
│ 审批人: [请选择 ]                    │  ← 空白，需填写
├─────────────────────────────────────┤
│ [确认并提交] [修改] [取消]           │
└─────────────────────────────────────┘

AI提示: "我已从对话中提取到请假信息，请确认日期和事由是否正确，
        并选择审批人。"
```

#### 13.8 与现有设计的整合

```typescript
// 技能返回指令时携带AI提取的数据
interface OpenFormInstruction {
  type: 'open_form';
  form_template_id: string;
  initial_data: Record<string, any>;
  ai_filled_fields: AIFilledField[];  // 新增：标记哪些字段是AI填充的
  fill_notification?: string;        // 新增：AI填充提示语
}

// 创建表单实例时记录AI填充信息
async function createFormInstance(params: CreateFormInstanceParams) {
  const instance = await formInstanceRepo.create({
    template_id: params.template_id,
    user_id: params.user_id,
    form_data: params.initial_data,
    ai_filled_fields: params.ai_filled_fields,  // 保存AI填充记录
    status: 'draft'
  });
  
  return instance;
}
```

## 总结

表单和报表本质上是**同一架构的两种数据流向**：
- **表单**：收集 → 处理 → 外发
- **报表**：查询 → 处理 → 展示

通过统一的目标系统配置、凭证管理和面板容器，可以无缝支持这两种场景，并为未来的Terminal、文档编辑等场景奠定基础。✌Bazinga！

本设计提供了一个完整的插件式表单系统架构：

1. **技能驱动**：表单由技能工具触发，与现有技能系统无缝集成
2. **动态渲染**：前端根据Schema动态渲染表单，无需硬编码
3. **状态管理**：完整的表单生命周期管理（草稿→提交→审核→完成）
4. **右侧面板集成**：利用现有的RightPanel架构，新增FormsTab
5. **对话融合**：表单提交后在对话中显示系统消息，保持上下文连贯
6. **分阶段实现**：MVP→增强→高级特性，逐步完善

这个设计既满足了当前的请假申请等场景，也为未来的SSH Terminal、双语阅读等复杂交互场景奠定了基础。
