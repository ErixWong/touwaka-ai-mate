# PDF Tools Implementation - Code Review

**日期：** 2026-03-02
**文件：** `data/skills/pdf/index.py`
**审查者：** Maria

---

## 总体评价

✅ **通过** - 代码结构清晰，功能完整，可以合并。

---

## 发现的问题

### 🔴 严重问题 (必须修复)

#### 1. 变量名覆盖内置函数 (第 315 行)

```python
format = params.get('format', 'png')  # ❌ 覆盖了内置函数 format()
```

**修复方案：**
```python
image_format = params.get('format', 'png')  # ✅
```

#### 2. 命令注入风险 (第 45-60 行)

```python
def run_script(script_name, args):
    cmd = [sys.executable, str(script_path)] + args
    result = subprocess.run(cmd, ...)  # ❌ args 直接拼接到命令
```

**风险：** 如果 `args` 包含恶意内容（如 `; rm -rf /`），可能导致命令注入。

**修复方案：**
```python
def run_script(script_name, args):
    # args 已经是列表形式，subprocess.run 会正确处理
    # 但应该验证 args 不包含危险字符
    for arg in args:
        if ';' in arg or '|' in arg or '`' in arg:
            raise ValueError(f"Invalid character in argument: {arg}")
    # ... 继续执行
```

### 🟡 中等问题 (建议修复)

#### 3. 未使用的导入 (第 18 行)

```python
import json  # ❌ 导入了但没使用
```

**修复：** 删除这行。

#### 4. 异常被静默忽略 (第 625 行)

```python
except Exception as e:
    # Some images may not be extractable
    pass  # ❌ 异常被完全忽略，没有日志
```

**修复方案：**
```python
except Exception as e:
    # 记录失败但继续处理其他图片
    import sys
    print(f"Warning: Failed to extract image {obj_name}: {e}", file=sys.stderr)
```

#### 5. 水印文件未验证 (第 470 行)

```python
watermark_page = PdfReader(watermark).pages[0]  # ❌ 没有验证文件是否存在
```

**修复方案：**
```python
if not os.path.exists(watermark):
    raise FileNotFoundError(f"Watermark file not found: {watermark}")
validate_pdf_file(watermark)
watermark_page = PdfReader(watermark).pages[0]
```

#### 6. 可能的 KeyError (第 613 行)

```python
if '/XObject' in page['/Resources']:  # ❌ 如果 '/Resources' 不存在会报错
```

**修复方案：**
```python
resources = page.get('/Resources', {})
if resources and '/XObject' in resources:
    xobjects = resources['/XObject'].get_object()
```

### 🟢 轻微问题 (可选修复)

#### 7. 缺少类型注解

```python
def read_pdf(params):  # ❌ 没有类型注解
```

**改进：**
```python
from typing import Dict, Any, Optional

def read_pdf(params: Dict[str, Any]) -> Dict[str, Any]:
```

#### 8. Docstring 不完整

函数的 docstring 没有描述参数和返回值的格式。

**改进：**
```python
def read_pdf(params):
    """
    Read PDF metadata and basic info.
    
    Args:
        params: Dictionary containing:
            - path (str): PDF file path
    
    Returns:
        Dictionary with:
            - page_count (int): Number of pages
            - metadata (dict): PDF metadata
            - encrypted (bool): Whether PDF is encrypted
    
    Raises:
        FileNotFoundError: If file doesn't exist
        ValueError: If file is not a PDF or too large
    """
```

#### 9. 页面范围逻辑可简化 (第 103-104 行)

```python
start = max(1, from_page) - 1
end = min(to_page if to_page else total_pages, total_pages)
```

**简化：**
```python
start = max(0, from_page - 1)
end = min(to_page or total_pages, total_pages)
```

---

## 代码亮点

1. ✅ **结构清晰** - 按功能分组，注释分隔
2. ✅ **工具路由设计** - `execute()` 函数使用 dict 映射，支持 snake_case 和 camelCase
3. ✅ **文件验证** - `validate_pdf_file()` 统一验证文件存在性、大小、类型
4. ✅ **延迟导入** - 只在需要时导入库，减少启动时间
5. ✅ **复用现有脚本** - 表单工具调用 `scripts/` 下的脚本，避免重复代码

---

## 修复清单

| 优先级 | 问题 | 行号 | 状态 |
|--------|------|------|------|
| 🔴 高 | 变量名覆盖 format() | 315 | ✅ 已修复 |
| 🔴 高 | 命令注入风险 | 45-60 | ✅ 已修复 |
| 🟡 中 | 未使用的 json 导入 | 18 | ✅ 已修复 |
| 🟡 中 | 异常被静默忽略 | 625 | ✅ 已修复 |
| 🟡 中 | 水印文件未验证 | 470 | ✅ 已修复 |
| 🟡 中 | 可能的 KeyError | 613 | ✅ 已修复 |

---

## 修复记录

**2026-03-02 所有问题已修复：**

1. ✅ 删除未使用的 `import json`
2. ✅ `run_script()` 添加命令注入检查
3. ✅ `convert_to_images()` 变量名改为 `image_format`
4. ✅ `add_watermark()` 添加水印文件验证
5. ✅ `extract_images()` 安全访问 `/Resources`，记录失败信息

---

**Code Review 完成！** 亲爱的
