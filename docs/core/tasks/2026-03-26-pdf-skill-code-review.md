# PDF Skill 代码审计报告

**审计日期**: 2026-03-26
**审计范围**: `data/skills/pdf/index.js` + `data/skills/pdf/SKILL.md`
**审计人**: Maria

---

## 📋 审计摘要

| 类别 | 问题数 | 严重程度 |
|------|--------|----------|
| 🔴 严重问题 | 1 | 高 |
| 🟡 中等问题 | 4 | 中 |
| 🟢 轻微问题 | 3 | 低 |

---

## 🔴 严重问题

### 1. SKILL.md 与代码参数不一致 - `convert_to_images`

**位置**: 
- SKILL.md 第 127-128 行
- index.js 第 516-525 行

**问题描述**:
SKILL.md 文档描述的参数与实际代码实现不一致：

| 参数 | SKILL.md | 代码实现 |
|------|----------|----------|
| 分辨率 | `dpi` (number, 默认: 150) | `scale` (number, 默认: 1.5) |
| 图片格式 | `format` ("png" \| "jpeg") | ❌ 未实现 |
| 宽度控制 | ❌ 未文档化 | `desiredWidth` (可选) |

**影响**: LLM 调用技能时可能传递错误参数，导致功能异常。

**建议修复**:
```javascript
// 方案 A: 更新 SKILL.md 匹配代码
- `dpi` (number, optional): 分辨率 DPI（默认: 150）
- `format` (string, optional): 图片格式 - "png" 或 "jpeg"（默认: "png"）
+ `scale` (number, optional): 缩放比例（默认: 1.5）
+ `desired_width` (number, optional): 期望宽度（像素）

// 方案 B: 更新代码支持 dpi 参数（推荐）
// dpi 150 ≈ scale 1.5, dpi 300 ≈ scale 3.0
const scale = params.dpi ? params.dpi / 100 : (params.scale || 1.5);
```

---

## 🟡 中等问题

### 2. `readPdf` 函数内存管理不完整

**位置**: index.js 第 168-188 行

**问题描述**:
`readPdf` 函数中创建了 `PDFParse` 实例，但如果 `getInfo()` 抛出异常，`parser.destroy()` 不会被调用。

**当前代码**:
```javascript
try {
  const parser = new PDFParse(loadParams);
  const infoResult = await parser.getInfo({ parsePageInfo });
  await parser.destroy();  // ❌ 如果 getInfo 抛异常，这行不会执行
  // ...
} catch (e) {
  console.error('pdf-parse getInfo failed:', e.message);
  // ❌ 没有 destroy 调用
}
```

**建议修复**:
```javascript
let parser;
try {
  parser = new PDFParse(loadParams);
  const infoResult = await parser.getInfo({ parsePageInfo });
  // ...
} catch (e) {
  console.error('pdf-parse getInfo failed:', e.message);
} finally {
  if (parser) {
    await parser.destroy();
  }
}
```

### 3. 冗余的 PDF 加载

**位置**: 
- `extractText` 第 227 行
- `extractTables` 第 284 行
- `extractImages` 第 868 行
- `convertToImages` 第 545 行

**问题描述**:
在处理分页提取时，代码先使用 `PDFDocument.load` 加载 PDF 获取总页数，然后 `PDFParse` 内部又会再次加载同一个 PDF。

**当前代码**:
```javascript
const pdfBytes = await readPdfFile(filePath);  // 第一次读取
// ...
if (fromPage || toPage) {
  const pdfDoc = await PDFDocument.load(pdfBytes);  // 第二次解析
  const totalPages = pdfDoc.getPageCount();
  // ...
  const result = await parser.getText({ partial });  // PDFParse 内部第三次解析
}
```

**影响**: 性能损耗，内存占用增加。

**建议修复**:
```javascript
// 方案 A: 使用 pdf-parse 的 info 获取页数
const info = await parser.getInfo();
const totalPages = info.total;

// 方案 B: 只在需要时加载 PDFDocument
// （当前实现可接受，但建议添加注释说明原因）
```

### 4. `extract_form_field_info` 参数文档不一致

**位置**: 
- SKILL.md 第 188 行
- index.js 第 758-800 行

**问题描述**:
SKILL.md 标注 `output` 为 required，但代码中 `output` 是可选的。

**SKILL.md**:
```
- `output` (string, required): 输出 JSON 文件路径
```

**代码**:
```javascript
if (output) {  // output 是可选的
  const resolvedPath = resolvePath(output);
  fs.writeFileSync(resolvedPath, JSON.stringify(result, null, 2), 'utf-8');
  result.path = resolvedPath;
}
```

**建议修复**:
更新 SKILL.md：
```markdown
- `output` (string, optional): 输出 JSON 文件路径（不指定则只返回结果）
```

### 5. 缺少参数范围验证

**位置**: 多处

**问题描述**:
多个函数缺少参数范围验证：

| 函数 | 缺少验证的参数 |
|------|----------------|
| `extractText` | `fromPage < 1`, `toPage > totalPages`, `fromPage > toPage` |
| `extractTables` | 同上 |
| `extractImages` | 同上，`imageThreshold < 0` |
| `rotatePages` | `degrees` 不是 90/180/270 |
| `createPdf` | `content` 为空数组 |

**建议修复**:
```javascript
// extractText 示例
if (fromPage !== undefined && fromPage < 1) {
  throw new Error('fromPage must be >= 1');
}
if (toPage !== undefined && toPage < fromPage) {
  throw new Error('toPage must be >= fromPage');
}
```

---

## 🟢 轻微问题

### 6. `extractImages` 返回大量数据

**位置**: index.js 第 883-893 行

**问题描述**:
`extractImages` 返回的图片数据包含完整的 Buffer 和 dataUrl，可能导致 JSON 响应过大。

**当前代码**:
```javascript
images: (page.images || []).map((img, imgIndex) => ({
  index: imgIndex + 1,
  width: img.width,
  height: img.height,
  data: img.data,      // Buffer 数据
  dataUrl: img.dataUrl  // Base64 数据 URL
}))
```

**建议**:
1. 添加 `saveToDir` 参数，将图片保存到文件而非返回数据
2. 或添加 `maxImageSize` 参数限制返回数据大小

### 7. 模块级变量初始化

**位置**: index.js 第 28-38 行

**问题描述**:
`getPdfParse()` 函数使用模块级变量延迟加载，虽然 Node.js 单线程下问题不大，但代码风格可改进。

**当前代码**:
```javascript
let PDFParse = null;
let VerbosityLevel = null;

function getPdfParse() {
  if (!PDFParse) {
    const pdfParseModule = require('pdf-parse');
    PDFParse = pdfParseModule.PDFParse;
    VerbosityLevel = pdfParseModule.VerbosityLevel;
  }
  return { PDFParse, VerbosityLevel };
}
```

**建议**:
```javascript
// 使用更清晰的单例模式
const getPdfParse = (() => {
  let cached = null;
  return () => {
    if (!cached) {
      const { PDFParse, VerbosityLevel } = require('pdf-parse');
      cached = { PDFParse, VerbosityLevel };
    }
    return cached;
  };
})();
```

### 8. 缺少 TypeScript 类型定义

**位置**: 整个文件

**问题描述**:
技能代码缺少 TypeScript 类型定义或 JSDoc 类型注释，不利于代码维护和 IDE 支持。

**建议**:
添加 JSDoc 类型注释：
```javascript
/**
 * @typedef {Object} ExtractTextParams
 * @property {string} path - PDF 文件路径
 * @property {number} [fromPage] - 起始页
 * @property {number} [toPage] - 结束页
 * @property {boolean} [suppressWarnings=true] - 抑制警告
 */
```

---

## ✅ 代码优点

1. **良好的错误处理**: 大部分函数都有 try-catch 包裹
2. **内存管理意识**: `extractText`, `extractTables`, `extractImages`, `convertToImages` 都正确使用了 `finally` 块调用 `parser.destroy()`
3. **路径安全检查**: `isPathAllowed()` 和 `resolvePath()` 实现了完善的路径访问控制
4. **角色权限分离**: 根据用户角色（管理员/技能创建者/普通用户）设置不同的访问权限
5. **代码结构清晰**: 按功能分组（基础操作、编辑操作、创建转换、安全操作、表单操作）

---

## 📝 修复优先级

| 优先级 | 问题 | 建议 |
|--------|------|------|
| P0 | `convert_to_images` 参数不一致 | 立即修复 SKILL.md |
| P1 | `readPdf` 内存管理 | 尽快修复 |
| P1 | 参数文档不一致 | 更新 SKILL.md |
| P2 | 参数范围验证 | 添加验证逻辑 |
| P3 | 其他轻微问题 | 后续优化 |

---

## 🔧 建议的修复代码

### 修复 1: 更新 SKILL.md 中 `convert_to_images` 参数

```markdown
### convert_to_images

将 PDF 页面转换为图片。

**参数：**
- `path` (string, required): PDF 文件路径
- `output_dir` (string, optional): 输出目录（不指定则只返回 dataUrl）
- `scale` (number, optional): 缩放比例（默认: 1.5，相当于 150 DPI）
- `desired_width` (number, optional): 期望宽度（像素），设置后将忽略 scale
- `prefix` (string, optional): 输出文件名前缀（默认: "page"）
- `from_page` (number, optional): 起始页（从1开始）
- `to_page` (number, optional): 结束页（包含）
- `suppress_warnings` (boolean, optional): 抑制警告输出（默认: true）
```

### 修复 2: `readPdf` 内存管理

```javascript
async function readPdf(params) {
  const { path: filePath, parsePageInfo = false, suppressWarnings = true } = params;
  
  const pdfBytes = await readPdfFile(filePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  // ... 基础信息获取 ...
  
  // 使用 pdf-parse v2 获取更丰富的信息
  let extendedInfo = null;
  let parser;
  
  try {
    const { PDFParse, VerbosityLevel } = getPdfParse();
    const loadParams = {
      data: pdfBytes,
      verbosity: suppressWarnings ? VerbosityLevel.ERRORS : VerbosityLevel.WARNINGS
    };
    
    parser = new PDFParse(loadParams);
    const infoResult = await parser.getInfo({ parsePageInfo });
    
    extendedInfo = {
      total: infoResult.total,
      infoData: infoResult.infoData,
      dates: infoResult.getDateNode ? infoResult.getDateNode() : null,
      pages: parsePageInfo ? infoResult.pages : undefined
    };
  } catch (e) {
    console.error('pdf-parse getInfo failed:', e.message);
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
  
  // ... 返回结果 ...
}
```

---

**审计完成** ✌Bazinga！亲爱的