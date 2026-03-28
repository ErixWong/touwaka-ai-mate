# PDF 技能重构设计（精简版）

## 背景

1. **命名规则变更**：工具名称现在会变成 `skill_mark + '__' + tool_name`
2. **精简要求**：将工具归纳为"读"和"写"两大类，通过参数区分具体操作

## 新设计：两个工具

### 1. `read` - PDF 读取工具

> 最终名称：`pdf__read`

通过 `operation` 参数区分具体读取操作：

| operation | 功能 | 关键参数 |
|-----------|------|----------|
| `metadata` | 读取元数据 | `parse_page_info` |
| `text` | 提取文本 | `from_page`, `to_page` |
| `tables` | 提取表格 | `from_page`, `to_page` |
| `images` | 提取图片 | `from_page`, `to_page`, `image_threshold` |
| `render` | 渲染页面为图片 | `output_dir`, `scale`, `from_page`, `to_page` |
| `markdown` | 转 Markdown | `output`, `from_page`, `to_page` |
| `fields` | 检查表单字段 | - |
| `field_info` | 获取字段信息 | `output` |

**调用示例：**
```javascript
// 读取元数据
pdf__read({ path: "doc.pdf", operation: "metadata" })

// 提取文本
pdf__read({ path: "doc.pdf", operation: "text", from_page: 1, to_page: 5 })

// 提取表格
pdf__read({ path: "doc.pdf", operation: "tables" })

// 渲染页面为图片
pdf__read({ path: "doc.pdf", operation: "render", output_dir: "./images", scale: 1.5 })
```

### 2. `write` - PDF 写入工具

> 最终名称：`pdf__write`

通过 `operation` 参数区分具体写入操作：

| operation | 功能 | 关键参数 |
|-----------|------|----------|
| `create` | 创建 PDF | `content[]`, `title`, `page_size` |
| `merge` | 合并 PDF | `paths[]` |
| `split` | 拆分 PDF | `output_dir`, `pages_per_file` |
| `rotate` | 旋转页面 | `pages[]`, `degrees` |
| `encrypt` | 加密 PDF | `user_password`, `owner_password` |
| `decrypt` | 解密 PDF | `password` |
| `watermark` | 添加水印 | `watermark`, `is_text` |
| `fill` | 填写表单 | `field_values` |

**调用示例：**
```javascript
// 创建 PDF
pdf__write({ output: "new.pdf", operation: "create", content: ["第一页内容", "第二页内容"] })

// 合并 PDF
pdf__write({ output: "merged.pdf", operation: "merge", paths: ["a.pdf", "b.pdf"] })

// 添加水印
pdf__write({ path: "doc.pdf", output: "watermarked.pdf", operation: "watermark", watermark: "机密文件" })

// 填写表单
pdf__write({ path: "form.pdf", output: "filled.pdf", operation: "fill", field_values: { name: "张三", date: "2026-03-28" } })
```

## 参数设计

### `read` 工具参数

```typescript
interface ReadParams {
  path: string;                    // PDF 文件路径（必需）
  operation: string;               // 操作类型（必需）
  // 通用参数
  from_page?: number;              // 起始页
  to_page?: number;                // 结束页
  suppress_warnings?: boolean;     // 抑制警告（默认 true）
  // metadata 操作参数
  parse_page_info?: boolean;       // 解析页面详情
  // images 操作参数
  image_threshold?: number;        // 图片尺寸阈值
  // render 操作参数
  output_dir?: string;             // 输出目录
  scale?: number;                  // 缩放比例
  desired_width?: number;          // 期望宽度
  prefix?: string;                 // 文件名前缀
  // markdown 操作参数
  output?: string;                 // 输出文件路径
}
```

### `write` 工具参数

```typescript
interface WriteParams {
  path?: string;                   // PDF 文件路径（部分操作必需）
  output: string;                  // 输出文件路径（必需）
  operation: string;               // 操作类型（必需）
  // create 操作参数
  content?: string[];              // 页面内容数组
  title?: string;                  // PDF 标题
  page_size?: string;              // 页面大小
  // merge 操作参数
  paths?: string[];                // 要合并的文件路径
  // split 操作参数
  output_dir?: string;             // 输出目录
  pages_per_file?: number;         // 每文件页数
  prefix?: string;                 // 文件名前缀
  // rotate 操作参数
  pages?: number[];                // 要旋转的页码
  degrees?: number;                // 旋转角度
  // encrypt 操作参数
  user_password?: string;          // 用户密码
  owner_password?: string;         // 所有者密码
  // decrypt 操作参数
  password?: string;               // 当前密码
  // watermark 操作参数
  watermark?: string;              // 水印内容
  is_text?: boolean;               // 是否文本水印
  // fill 操作参数
  field_values?: object;           // 字段值键值对
}
```

## 工具数量对比

| 版本 | 工具数量 | 说明 |
|------|----------|------|
| 原版 | 16 | 每个操作一个工具 |
| 精简版 | **2** | `read` + `write` |

## 快速参考

| 任务 | 工具 | operation |
|------|------|-----------|
| 读取元数据 | `read` | `metadata` |
| 提取文本 | `read` | `text` |
| 提取表格 | `read` | `tables` |
| 提取图片 | `read` | `images` |
| 渲染页面 | `read` | `render` |
| 转 Markdown | `read` | `markdown` |
| 检查表单字段 | `read` | `fields` |
| 获取字段信息 | `read` | `field_info` |
| 创建 PDF | `write` | `create` |
| 合并 PDF | `write` | `merge` |
| 拆分 PDF | `write` | `split` |
| 旋转页面 | `write` | `rotate` |
| 加密 PDF | `write` | `encrypt` |
| 解密 PDF | `write` | `decrypt` |
| 添加水印 | `write` | `watermark` |
| 填写表单 | `write` | `fill` |