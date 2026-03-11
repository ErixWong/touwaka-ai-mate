# Expert/Assistant 图片读取工具设计方案

## 1. 背景

当前系统已具备多模态消息处理能力（`llm-client.js`），但 Expert 和 Assistant 无法主动读取工作区中的图片文件进行视觉分析。用户需要手动将图片转换为 base64 后传入消息，这增加了使用复杂度。

本方案旨在实现一个 `read_image_for_vision` 工具，让 Expert/Assistant 能够根据任务需要主动读取图片并交由视觉模型分析。

## 2. 设计原则

### 2.1 安全边界
- LLM 本身不直接访问文件系统
- 图片读取通过**受控工具**执行
- 路径访问必须限制在白名单目录内

### 2.2 职责分离
- **工具层**: 负责安全校验、文件读取、格式转换
- **Manager 层**: 负责识别图片资产、构造多模态消息
- **LLM 层**: 接收多模态消息，执行视觉推理

### 2.3 数据策略
- base64 仅用于模型调用，不写入日志和数据库
- `assistant_messages` 只记录摘要信息（文件名、类型、大小）
- 主对话消息不包含图片原始数据

## 3. 整体架构

```
User
  └── Expert
        ├── 判断需要读图
        └── ToolManager.executeTool('read_image_for_vision', { file_path })
              │
              ▼
        read_image_for_vision 工具
              ├── 安全校验路径
              ├── 读取图片文件
              ├── 转换为 data URL
              └── 返回 image_asset
              │
              ▼
        ToolManager / AssistantManager
              ├── 识别 image_asset 类型
              ├── 缓存图片资产
              └── 构造多模态消息
              │
              ▼
        LLMClient.chat()
              └── 调用视觉模型分析
```

## 4. 工具设计

### 4.1 工具定义

```javascript
{
  name: 'read_image_for_vision',
  description: '读取本地图片文件，为视觉模型准备图片输入。支持 PNG、JPG、WEBP、GIF 格式。',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: '图片文件的绝对路径或相对于工作区的路径'
      },
      max_size_mb: {
        type: 'number',
        description: '最大允许的图片大小（MB），默认 10',
        default: 10
      }
    },
    required: ['file_path']
  }
}
```

### 4.2 输出结构

工具返回结构化的 `image_asset` 对象，而非裸 base64：

```javascript
{
  kind: 'image_asset',
  source: 'local_file',
  file_path: '/workspace/topic_abc123/contract.png',
  file_name: 'contract.png',
  mime_type: 'image/png',
  data_url: 'data:image/png;base64,iVBORw0KGgo...',
  size_bytes: 123456,
  dimensions: {
    width: 1920,
    height: 1080
  }
}
```

### 4.3 路径安全校验

工具执行前必须进行安全检查：

| 检查项 | 规则 |
|--------|------|
| 路径存在 | 文件必须实际存在 |
| 白名单目录 | 只允许读取工作区、用户上传目录等白名单路径 |
| 文件类型 | 只允许 `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` |
| 文件大小 | 默认限制 10MB，可配置 |

白名单目录配置：

```javascript
const ALLOWED_PATHS = [
  path.resolve(WORKSPACE_ROOT),      // 工作区根目录
  path.resolve(UPLOAD_DIR),          // 用户上传目录
  path.resolve(TEMP_DIR)             // 临时目录
];
```

## 5. 技能实现

### 5.1 目录结构

```
data/skills/vision-tools/
├── SKILL.md           # 技能定义
├── index.js           # 技能入口
└── lib/
    └── image-reader.js # 图片读取核心逻辑
```

### 5.2 SKILL.md

```markdown
# vision-tools 技能

提供图片处理相关的工具，支持 Expert 和 Assistant 进行视觉分析。

## 工具列表

### read_image_for_vision

读取本地图片文件，为视觉模型准备图片输入。

**输入参数:**
- `file_path` (必需): 图片文件路径
- `max_size_mb` (可选): 最大文件大小限制，默认 10MB

**返回:**
- `image_asset`: 包含 base64 data URL 的结构化对象

**安全限制:**
- 只允许读取白名单目录内的文件
- 只支持 PNG、JPG、WEBP、GIF 格式
- 文件大小不能超过配置限制
```

### 5.3 核心实现 (index.js)

```javascript
const fs = require('fs');
const path = require('path');

// 允许的图片扩展名和 MIME 类型映射
const IMAGE_EXTENSIONS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

// 白名单目录（从环境变量或配置获取）
function getAllowedPaths() {
  const workspaceRoot = process.env.WORKSPACE_ROOT || '/workspace';
  const uploadDir = process.env.UPLOAD_DIR || '/uploads';
  const tempDir = process.env.TEMP_DIR || '/tmp/uploads';
  return [workspaceRoot, uploadDir, tempDir].map(p => path.resolve(p));
}

// 安全校验
function validatePath(filePath, allowedPaths) {
  const resolved = path.resolve(filePath);

  // 检查是否在白名单目录内
  const isAllowed = allowedPaths.some(allowedPath =>
    resolved.startsWith(allowedPath + path.sep) || resolved === allowedPath
  );

  if (!isAllowed) {
    throw new Error(`路径不在允许的目录范围内: ${filePath}`);
  }

  return resolved;
}

// 读取图片并转换为 data URL
async function readImageForVision(filePath, maxSizeMb = 10) {
  const allowedPaths = getAllowedPaths();
  const resolvedPath = validatePath(filePath, allowedPaths);

  // 检查文件是否存在
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  // 检查文件扩展名
  const ext = path.extname(resolvedPath).toLowerCase();
  if (!IMAGE_EXTENSIONS[ext]) {
    throw new Error(`不支持的图片格式: ${ext}`);
  }

  // 检查文件大小
  const stats = fs.statSync(resolvedPath);
  const maxBytes = maxSizeMb * 1024 * 1024;
  if (stats.size > maxBytes) {
    throw new Error(`文件大小超过限制: ${stats.size} > ${maxBytes}`);
  }

  // 读取文件并转换
  const buffer = fs.readFileSync(resolvedPath);
  const base64 = buffer.toString('base64');
  const mimeType = IMAGE_EXTENSIONS[ext];
  const dataUrl = `data:${mimeType};base64,${base64}`;

  return {
    kind: 'image_asset',
    source: 'local_file',
    file_path: resolvedPath,
    file_name: path.basename(resolvedPath),
    mime_type: mimeType,
    data_url: dataUrl,
    size_bytes: stats.size
  };
}

// 技能导出
module.exports = {
  tools: {
    read_image_for_vision: {
      handler: async (params, context) => {
        const { file_path, max_size_mb } = params;
        return await readImageForVision(file_path, max_size_mb);
      }
    }
  }
};
```

## 6. Manager 层集成

### 6.1 ToolManager 处理 image_asset

在 `tool-manager.js` 中增加对 `image_asset` 的识别和处理：

```javascript
// 在 formatToolResultsForLLM 方法中
formatToolResultsForLLM(toolResults) {
  return toolResults.map(result => {
    // 检测是否为 image_asset 类型
    if (result.output?.kind === 'image_asset') {
      // 返回摘要信息而非完整 base64
      return {
        tool_call_id: result.tool_call_id,
        content: `已读取图片: ${result.output.file_name} (${result.output.mime_type}, ${Math.round(result.output.size_bytes / 1024)}KB)`
      };
    }
    // 普通结果
    return {
      tool_call_id: result.tool_call_id,
      content: typeof result.output === 'string' ? result.output : JSON.stringify(result.output)
    };
  });
}

// 新增方法：提取图片资产
extractImageAssets(toolResults) {
  return toolResults
    .filter(r => r.output?.kind === 'image_asset')
    .map(r => r.output);
}
```

### 6.2 AssistantManager 构造多模态消息

在 `assistant-manager.js` 中增加多模态消息构造：

```javascript
async executeLLMWithVision(systemPrompt, userPrompt, imageAssets, options = {}) {
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  // 构造用户消息
  const userContent = [{ type: 'text', text: userPrompt }];

  // 添加图片
  for (const asset of imageAssets) {
    userContent.push({
      type: 'image_url',
      image_url: { url: asset.data_url }
    });
  }

  messages.push({ role: 'user', content: userContent });

  // 调用 LLMClient
  const response = await this.llmClient.chat({
    messages,
    model: options.model || this.visionModelId,
    ...options
  });

  return response;
}
```

### 6.3 模型能力检查

在调用视觉模型前检查当前模型是否支持多模态：

```javascript
async checkVisionCapability(modelId) {
  const model = await this.getModel(modelId);
  if (model.model_type !== 'multimodal') {
    throw new Error(`模型 ${modelId} 不支持视觉分析，请配置 multimodal 类型模型`);
  }
  return true;
}
```

## 7. 消息记录策略

### 7.1 assistant_messages 记录

只记录摘要信息，不记录 base64：

```javascript
// 工具调用记录
{
  role: 'tool',
  message_type: 'tool_call',
  tool_name: 'read_image_for_vision',
  content: JSON.stringify({ file_path: '/workspace/topic_123/contract.png' })
}

// 工具结果记录
{
  role: 'tool',
  message_type: 'tool_result',
  tool_name: 'read_image_for_vision',
  content: JSON.stringify({
    kind: 'image_asset',
    file_name: 'contract.png',
    mime_type: 'image/png',
    size_bytes: 123456,
    // 不包含 data_url
  })
}
```

### 7.2 主对话消息

Expert 回复给用户时，只包含分析结果摘要：

```
已完成图片分析。识别到图片中的关键条款包括：[分析结果摘要]。
```

## 8. 使用场景

### 场景 A: Expert 主动读取图片

用户说："帮我分析这张合同截图"

```
1. Expert 判断需要读取图片
2. Expert 调用 read_image_for_vision({ file_path: '/workspace/topic_123/contract.png' })
3. 工具返回 image_asset
4. ToolManager 提取图片资产
5. Expert 发起多模态推理
6. 返回分析结果给用户
```

### 场景 B: Assistant 自主读图

文档助理在处理论文时发现图片文件：

```
1. Assistant 发现 /workspace/topic_123/figure_1.png
2. Assistant 判断需要分析图片内容
3. Assistant 调用 read_image_for_vision
4. AssistantManager 构造多模态消息
5. 调用视觉模型分析
6. 将结果写入 assistant_messages
7. 回传给 Expert
```

## 9. 配置项

```javascript
// 环境变量或配置文件
{
  VISION_TOOLS: {
    MAX_FILE_SIZE_MB: 10,
    ALLOWED_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    ALLOWED_PATHS: [
      '${WORKSPACE_ROOT}',
      '${UPLOAD_DIR}',
      '${TEMP_DIR}'
    ]
  },
  DEFAULT_VISION_MODEL: 'gpt-4o-vision'
}
```

## 10. 错误处理

| 错误场景 | 处理方式 |
|----------|----------|
| 文件不存在 | 返回错误：`文件不存在: ${filePath}` |
| 路径不在白名单 | 返回错误：`路径不在允许的目录范围内` |
| 格式不支持 | 返回错误：`不支持的图片格式: ${ext}` |
| 文件过大 | 返回错误：`文件大小超过限制` |
| 模型不支持视觉 | 返回错误：`当前模型不支持视觉分析` |

## 11. 实现步骤

1. **创建技能目录**: `data/skills/vision-tools/`
2. **实现图片读取逻辑**: `index.js` + `lib/image-reader.js`
3. **注册技能**: 在数据库中添加技能记录
4. **修改 ToolManager**: 增加 `image_asset` 识别和提取
5. **修改 AssistantManager**: 增加多模态消息构造方法
6. **增加模型能力检查**: 在调用前检查是否为多模态模型
7. **测试**: 单元测试 + 集成测试

## 12. 与现有系统的兼容性

### 12.1 llm-client.js 多模态支持

现有 `llm-client.js` 已支持多模态格式：
- 数组格式: `[{ type: 'text', text: '...' }, { type: 'image_url', image_url: { url: '...' } }]`
- JSON 包装格式: `{ type: 'multimodal', content: [...] }`
- Markdown 格式: `![alt](url)`

本方案的 `image_asset.data_url` 可直接用于 `image_url.url` 字段。

### 12.2 前端图片处理

现有 `frontend/src/utils/imageCompress.ts` 提供图片压缩功能，可用于前端预处理后再上传。

### 12.3 工作空间系统

现有 `task.controller.js` 定义的工作空间结构（input/output/temp/logs）可作为白名单目录的一部分。

## 13. 后续扩展

- 支持批量读取多张图片
- 支持图片压缩/裁剪预处理
- 支持 URL 图片获取
- 支持 PDF 页面转图片