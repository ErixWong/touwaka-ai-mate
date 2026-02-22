# 技能管理系统设计方案

## 概述

技能管理系统采用**AI驱动**的方式，实现灵活的技能注册、解析和使用。

**核心理念**：
- 不严格定义工具边界，利用LLM理解能力
- 技能注册时由AI解析生成工具清单
- 支持多种技能来源（URL/ZIP/本地目录）

```
┌─────────────────────────────────────────────────────────────┐
│                    技能管理系统架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  技能来源（添加技能页面）                             │   │
│  │  1. URL（GitHub等）                                  │   │
│  │  2. 上传ZIP文件                                      │   │
│  │  3. 本地目录                                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  AI解析（便宜AI：DeepSeek/通义）                     │   │
│  │  - 安全检查（检测恶意代码）                          │   │
│  │  - 提取工具清单                                      │   │
│  │  - 生成结构化元数据                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  数据库存储                                          │   │
│  │  - skills 表：技能元数据                             │   │
│  │  - skill_tools 表：工具清单（AI生成）                │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  技能使用                                            │   │
│  │  - AI检索：搜索工具清单                              │   │
│  │  - AI执行：read + execute + http_get                 │   │
│  │  - 技能维护：通过对话维修、升级                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 一、技能来源

### 1.1 三种来源方式

| 来源 | 说明 | 流程 |
|------|------|------|
| **URL** | GitHub仓库或技能平台链接 | 后端下载文件 |
| **上传ZIP** | 用户上传ZIP压缩包 | 后端解压 |
| **本地目录** | 用户指定本地路径 | 直接使用 |

### 1.2 添加技能页面

```
┌─────────────────────────────────────────────────────────────┐
│  添加技能                                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ○ 从URL安装                                                │
│    ┌─────────────────────────────────────────────────────┐  │
│    │ https://github.com/user/skill-repo                  │  │
│    └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ○ 上传ZIP文件                                              │
│    [选择文件...]  skill-package.zip                         │
│                                                             │
│  ○ 本地目录                                                 │
│    ┌─────────────────────────────────────────────────────┐  │
│    │ /path/to/skills/my-skill                            │  │
│    └─────────────────────────────────────────────────────┘  │
│                                                             │
│  [分析并安装]                                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、技能注册流程

### 2.1 完整流程

```
用户添加技能（URL/ZIP/本地目录）
    │
    ▼
后端获取技能文件
    │
    ▼
调用便宜AI分析技能（DeepSeek/通义）
    │
    ├─► 安全检查（检测恶意代码）
    │     - 可疑的eval、exec调用
    │     - 网络请求到可疑地址
    │     - 文件系统敏感操作
    │
    ├─► 提取技能元数据
    │     - 名称、描述、版本、作者
    │     - 标签（用于检索）
    │
    └─► 提取工具清单
          - 工具名称、描述
          - 工具类型（http/script/builtin）
          - 使用方式
    │
    ▼
存入数据库
    ├─► skills 表
    └─► skill_tools 表
    │
    ▼
返回注册结果
```

### 2.2 AI解析Prompt示例

```javascript
const prompt = `
你是一个技能分析器。分析以下技能文件，提取结构化信息。

## 任务

1. 安全检查
   - 检测可疑代码（eval、exec、敏感网络请求等）
   - 给出安全评分（0-100）

2. 技能元数据
   - 名称（英文ID）
   - 显示名称
   - 描述
   - 版本
   - 作者
   - 标签（数组）

3. 工具清单
   - 工具名称
   - 工具描述
   - 工具类型：http（API调用）/ script（脚本执行）/ builtin（内置）
   - 使用方式（简要说明）

## 技能文件

${skillFilesContent}

## 输出格式

返回JSON：
{
  "security": {
    "score": 85,
    "warnings": ["..."]
  },
  "skill": {
    "id": "web-search-api",
    "name": "Web Search API",
    "description": "...",
    "version": "1.0.0",
    "author": "community",
    "tags": ["search", "web", "api"]
  },
  "tools": [
    {
      "name": "search",
      "description": "搜索网页",
      "type": "http",
      "usage": "GET {instance}/search?q={query}&format=json"
    },
    {
      "name": "get_instances",
      "description": "获取可用的SearXNG实例",
      "type": "http",
      "usage": "GET https://searx.space/data/instances.json"
    }
  ]
}
`;
```

---

## 三、数据库设计

### 3.1 skills 表

```sql
CREATE TABLE skills (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  version VARCHAR(32),
  author VARCHAR(128),
  tags JSON,                         -- ["search", "web", "api"]
  
  -- 来源信息
  source_type ENUM('url', 'zip', 'local') DEFAULT 'local',
  source_path VARCHAR(512),          -- 本地路径
  source_url VARCHAR(512),           -- 原始URL
  
  -- 文件内容
  skill_md TEXT,                     -- SKILL.md 内容
  
  -- 安全信息
  security_score INT DEFAULT 100,    -- AI评估的安全评分
  security_warnings JSON,            -- 安全警告
  
  -- 配置
  config TEXT,                       -- JSON配置
  
  -- 状态
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 3.2 skill_tools 表

```sql
CREATE TABLE skill_tools (
  id INT AUTO_INCREMENT PRIMARY KEY,
  skill_id VARCHAR(64) NOT NULL,
  
  -- 工具信息（AI生成）
  name VARCHAR(64) NOT NULL,
  description TEXT,
  type ENUM('http', 'script', 'builtin') DEFAULT 'http',
  usage TEXT,                        -- 使用方式说明
  
  -- 执行配置（可选，根据type不同）
  command VARCHAR(512),              -- 脚本命令
  endpoint VARCHAR(512),             -- HTTP端点模板
  method VARCHAR(16),                -- HTTP方法
  
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE KEY (skill_id, name)
);
```

### 3.3 expert_skills 关联表（已有）

管理专家启用的技能及其配置。

---

## 四、AI基础能力（参考 Claude Code 设计）

系统为AI提供完整的文件操作工具集，共7类14个工具。

### 4.1 读取类

#### read_lines - 按行读取

```javascript
read_lines({
  path: "skills/xxx/file.js",
  start: 0,      // 起始行（0-based）
  count: 100     // 读取行数，默认100
})

// 返回
{
  content: "...",
  start: 0,
  returnedLines: 100,
  totalLines: 500,
  hasMore: true
}
```

#### read_bytes - 按字节读取

```javascript
read_bytes({
  path: "skills/xxx/data.bin",
  start: 0,      // 起始字节
  count: 50000   // 读取字节数，默认50KB
})

// 返回
{
  content: "...",
  start: 0,
  bytesRead: 50000,
  totalBytes: 1000000,
  hasMore: true
}
```

#### list_files - 列出目录

```javascript
list_files({
  path: "skills/xxx",
  recursive: true,    // 递归列出
  pattern: "*.js"     // 文件过滤（可选）
})

// 返回
{
  files: [
    { name: "index.js", type: "file", size: 1234 },
    { name: "lib/", type: "directory" }
  ]
}
```

### 4.2 写入类

#### write_file - 写入文件（覆盖）

```javascript
write_file({
  path: "skills/xxx/new.js",
  content: "// new file content"
})

// 返回
{ success: true, path: "skills/xxx/new.js", size: 20 }
```

#### append_file - 追加内容

```javascript
append_file({
  path: "skills/xxx/log.txt",
  content: "new line\n"
})

// 返回
{ success: true, appendedSize: 9 }
```

### 4.3 编辑类

#### replace_in_file - 精确替换

```javascript
replace_in_file({
  path: "skills/xxx/file.js",
  search: "old text",
  replace: "new text",
  replaceAll: false   // 是否替换全部，默认false
})

// 返回
{ success: true, replacements: 1 }
```

#### insert_at_line - 在指定行插入

```javascript
insert_at_line({
  path: "skills/xxx/file.js",
  line: 10,           // 在第10行后插入
  content: "// new comment\n"
})

// 返回
{ success: true, insertedAt: 10 }
```

#### delete_lines - 删除指定行

```javascript
delete_lines({
  path: "skills/xxx/file.js",
  start: 5,    // 起始行
  count: 3     // 删除3行
})

// 返回
{ success: true, deletedLines: 3 }
```

### 4.4 搜索类

#### search_in_file - 在文件中搜索

```javascript
search_in_file({
  path: "skills/xxx",
  pattern: "function\\s+\\w+",
  filePattern: "*.js",    // 文件过滤
  contextLines: 2         // 上下文行数
})

// 返回
{
  matches: [
    {
      file: "index.js",
      line: 10,
      content: "function hello() {",
      context: ["// comment", "function hello() {", "  return 'hi'"]
    }
  ],
  totalMatches: 5
}
```

#### grep - 正则搜索（跨文件）

```javascript
grep({
  path: "skills/xxx",
  pattern: "TODO",
  filePattern: "*.{js,ts}",
  ignoreCase: true
})

// 返回
{
  matches: [
    { file: "a.js", line: 5, content: "// TODO: fix this" },
    { file: "b.ts", line: 20, content: "// TODO: refactor" }
  ]
}
```

### 4.5 文件管理类

```javascript
// copy_file - 复制文件
copy_file({ source: "skills/xxx/a.js", dest: "skills/yyy/b.js" })

// move_file - 移动文件
move_file({ source: "skills/xxx/old.js", dest: "skills/xxx/new.js" })

// delete_file - 删除文件
delete_file({ path: "skills/xxx/unused.js" })

// create_dir - 创建目录
create_dir({ path: "skills/xxx/subdir" })
```

### 4.6 压缩类

#### zip - 创建ZIP压缩包

```javascript
zip({
  source: "skills/xxx",        // 源文件或目录
  dest: "backup/xxx.zip",      // 目标ZIP路径
  recursive: true              // 递归压缩目录
})

// 返回
{ success: true, filesCount: 15, compressedSize: 12345 }
```

#### unzip - 解压ZIP文件

```javascript
unzip({
  source: "uploads/skill.zip", // ZIP文件路径
  dest: "skills/xxx",          // 解压目标目录
  overwrite: false             // 是否覆盖已存在的文件
})

// 返回
{
  success: true,
  files: ["SKILL.md", "index.js", "config.json"],
  extractedTo: "skills/xxx"
}
```

**实现**：使用 `adm-zip` 库（纯JS，跨平台）

```javascript
import AdmZip from 'adm-zip';

async function unzip(params) {
  const { source, dest, overwrite = false } = params;
  const zip = new AdmZip(source);
  zip.extractAllTo(dest, overwrite);
  return {
    success: true,
    files: zip.getEntries().map(e => e.entryName)
  };
}
```

### 4.7 执行类

#### execute - 执行脚本

```javascript
execute({
  command: "./search.py",
  args: ["--query", "hello"],
  timeout: 30000,    // 超时（毫秒）
  cwd: "skills/xxx"  // 工作目录
})

// 自动识别脚本类型：
// .sh → bash
// .py → python
// .js → node
```

### 4.8 网络类

#### http_get - HTTP GET 请求

```javascript
http_get({
  url: "https://api.example.com/data",
  headers: { "Authorization": "Bearer xxx" },
  timeout: 10000,
  maxSize: 100000   // 最大响应大小
})
```

#### http_post - HTTP POST 请求

```javascript
http_post({
  url: "https://api.example.com/submit",
  body: { key: "value" },
  headers: { "Content-Type": "application/json" },
  timeout: 10000
})
```

### 4.9 工具清单汇总

| 类别 | 工具 | 说明 |
|------|------|------|
| **读取** | `read_lines` | 按行读取（默认100行） |
| | `read_bytes` | 按字节读取（默认50KB） |
| | `list_files` | 列出目录内容 |
| **写入** | `write_file` | 覆盖写入 |
| | `append_file` | 追加内容 |
| **编辑** | `replace_in_file` | 精确替换 |
| | `insert_at_line` | 行插入 |
| | `delete_lines` | 删除行 |
| **搜索** | `search_in_file` | 文件内搜索 |
| | `grep` | 跨文件搜索 |
| **管理** | `copy_file` | 复制文件 |
| | `move_file` | 移动文件 |
| | `delete_file` | 删除文件 |
| | `create_dir` | 创建目录 |
| **压缩** | `zip` | 创建ZIP压缩包 |
| | `unzip` | 解压ZIP文件 |
| **执行** | `execute` | 执行脚本 |
| **网络** | `http_get` | GET请求 |
| | `http_post` | POST请求 |

### 4.10 安全措施

1. **路径限制**：所有文件操作限制在 `skills` 目录内
2. **大小限制**：读取默认50KB，防止上下文爆炸
3. **超时控制**：执行和网络请求有超时限制
4. **危险命令过滤**：禁止 `rm -rf /` 等危险操作

---

## 五、技能使用流程

### 5.1 AI检索技能

```sql
-- 搜索工具描述
SELECT s.id, s.name, s.description, t.name as tool_name, t.description as tool_desc
FROM skills s
JOIN skill_tools t ON s.id = t.skill_id
WHERE s.is_active = TRUE
  AND (s.description LIKE '%搜索%' OR t.description LIKE '%搜索%');
```

### 5.2 AI执行流程

```
用户: "搜索最新的AI新闻"
    │
    ▼
AI检索 skill_tools 表，找到 web-search-api.search
    │
    ▼
AI读取 SKILL.md 了解详细用法
    │
    ▼
AI选择执行方式：
    ├─► type=http → http_get("https://searx.party/search?q=AI新闻&format=json")
    └─► type=script → execute("python ./search.py --query=AI新闻")
    │
    ▼
AI解析结果，回复用户
```

---

## 六、技能维护

### 6.1 通过对话维修技能

用户可以和技能专家对话，对技能进行改进：

```
用户: "web-search-api 技能搜索结果不准确"

技能专家: 
1. 读取 SKILL.md 分析问题
2. 建议修改搜索参数或更换实例
3. 更新 SKILL.md 或配置
4. 重新注册技能（更新工具清单）
```

### 6.2 技能升级流程

```
1. 用户上传新版本（URL/ZIP/本地）
2. AI重新分析，生成新的工具清单
3. 更新 skills 和 skill_tools 表
4. 保留用户配置（expert_skills）
```

---

## 七、API设计

### 7.1 技能管理API

```
GET    /api/skills                    # 获取技能列表
GET    /api/skills/:id                # 获取技能详情（含工具清单）
POST   /api/skills/from-url           # 从URL安装
POST   /api/skills/from-zip           # 从ZIP安装
POST   /api/skills/from-path          # 从本地目录安装
PUT    /api/skills/:id                # 更新技能
DELETE /api/skills/:id                # 删除技能
POST   /api/skills/:id/reanalyze      # 重新分析技能
```

### 7.2 安装请求示例

```javascript
// POST /api/skills/from-url
{
  "url": "https://github.com/besoeasy/open-skills/tree/main/skills/web-search-api"
}

// POST /api/skills/from-zip
// FormData: file=skill.zip

// POST /api/skills/from-path
{
  "path": "/shared/skills/my-skill"
}
```

### 7.3 响应示例

```javascript
{
  "success": true,
  "skill": {
    "id": "web-search-api",
    "name": "Web Search API",
    "description": "Free web search using SearXNG",
    "security_score": 95,
    "tools": [
      { "name": "search", "type": "http", "description": "搜索网页" },
      { "name": "get_instances", "type": "http", "description": "获取实例列表" }
    ]
  }
}
```

---

## 八、安全考虑

### 8.1 AI安全检查

注册时由便宜AI分析代码，检测：
- 可疑的 `eval`、`exec`、`Function` 调用
- 网络请求到非预期地址
- 文件系统敏感操作（读写敏感路径）
- 混淆代码

### 8.2 执行隔离

- 脚本在子进程中执行
- 设置资源限制（CPU、内存、时间）
- 网络访问可配置白名单

### 8.3 用户确认

- 安装前显示安全评分和警告
- 低分技能需要用户确认

---

## 九、实现计划

### Phase 1 - MVP

| 任务 | 说明 |
|------|------|
| 后端：技能安装API | URL/ZIP/本地目录三种来源 |
| 后端：AI分析服务 | 调用便宜AI解析技能 |
| 后端：技能CRUD | 基础管理功能 |
| 前端：添加技能页面 | 三种来源的表单 |
| 前端：技能列表页面 | 查看已安装技能 |

### Phase 2 - 增强

- 技能详情页（显示工具清单）
- 技能配置编辑
- 技能重新分析

### Phase 3 - 高级

- 技能版本管理
- 技能依赖管理
- 技能分享功能

---

## 十、案例：web-search-api 技能

### 安装流程

```
1. 用户输入URL: https://github.com/besoeasy/open-skills/tree/main/skills/web-search-api
    │
    ▼
2. 后端下载 SKILL.md
    │
    ▼
3. 调用AI分析
    │
    ├─► 安全评分: 95（无可疑代码）
    ├─► 技能元数据: { id: "web-search-api", name: "Web Search API", ... }
    └─► 工具清单: [
          { name: "search", type: "http", ... },
          { name: "get_instances", type: "http", ... },
          { name: "multi_search", type: "http", ... }
        ]
    │
    ▼
4. 存入数据库
    │
    ▼
5. 返回结果
```

### AI使用

```
用户: "搜索AI新闻"
    │
    ▼
AI检索: SELECT * FROM skill_tools WHERE description LIKE '%搜索%'
    → 找到 web-search-api.search
    │
    ▼
AI读取 SKILL.md 了解 API 格式
    │
    ▼
AI执行: http_get("https://searx.party/search?q=AI新闻&format=json")
    │
    ▼
AI解析JSON，回复用户
```

---

*文档版本: v2.0*
*更新日期: 2026-02-22*
