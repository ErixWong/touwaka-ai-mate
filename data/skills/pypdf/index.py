#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PyPDF Skill - PDF 处理技能 (Python 版)
使用 PyMuPDF (fitz) 实现，内存效率高，适合处理大文件

工具设计：
- read: PDF 读取工具（通过 operation 参数区分具体操作）
- write: PDF 写入工具（通过 operation 参数区分具体操作）

依赖：
- PyMuPDF (fitz): PDF 操作核心库，内存映射方式处理大文件
"""

import fitz  # PyMuPDF
import os
import sys
import json
import base64
import traceback
from typing import Dict, List, Any, Optional, Tuple

# 用户角色检查
IS_ADMIN = os.environ.get('IS_ADMIN') == 'true'
IS_SKILL_CREATOR = os.environ.get('IS_SKILL_CREATOR') == 'true'

# 允许的基础路径
DATA_BASE_PATH = os.environ.get('DATA_BASE_PATH') or os.path.join(os.getcwd(), 'data')
USER_ID = os.environ.get('USER_ID') or 'default'
WORKING_DIRECTORY = os.environ.get('WORKING_DIRECTORY')

if WORKING_DIRECTORY:
    USER_WORK_DIR = os.path.join(DATA_BASE_PATH, WORKING_DIRECTORY)
else:
    USER_WORK_DIR = os.path.join(DATA_BASE_PATH, 'work', USER_ID)

# 根据用户角色设置允许的路径
if IS_ADMIN:
    ALLOWED_BASE_PATHS = [DATA_BASE_PATH]
elif IS_SKILL_CREATOR:
    ALLOWED_BASE_PATHS = [
        os.path.join(DATA_BASE_PATH, 'skills'),
        os.path.join(DATA_BASE_PATH, 'work', USER_ID)
    ]
else:
    ALLOWED_BASE_PATHS = [USER_WORK_DIR]


def is_path_allowed(target_path: str) -> bool:
    """检查路径是否被允许"""
    resolved = os.path.realpath(os.path.abspath(target_path))
    
    for base_path in ALLOWED_BASE_PATHS:
        resolved_base = os.path.realpath(os.path.abspath(base_path))
        try:
            if resolved.startswith(resolved_base):
                return True
        except Exception:
            pass
    return False


def resolve_path(relative_path: str) -> str:
    """解析路径（支持相对路径）"""
    if os.path.isabs(relative_path):
        if not is_path_allowed(relative_path):
            raise ValueError(f"Path not allowed: {relative_path}")
        return relative_path
    
    for base_path in ALLOWED_BASE_PATHS:
        resolved = os.path.join(base_path, relative_path)
        if os.path.exists(resolved) or is_path_allowed(resolved):
            if not is_path_allowed(resolved):
                raise ValueError(f"Path not allowed: {resolved}")
            return resolved
    
    default_path = os.path.join(ALLOWED_BASE_PATHS[0], relative_path)
    if not is_path_allowed(default_path):
        raise ValueError(f"Path not allowed: {default_path}")
    return default_path


def ensure_dir(file_path: str) -> str:
    """确保目录存在"""
    dir_path = os.path.dirname(file_path)
    if dir_path and not os.path.exists(dir_path):
        os.makedirs(dir_path, exist_ok=True)
    return file_path


# ==================== 读操作实现 ====================

def read_metadata(params: Dict[str, Any]) -> Dict[str, Any]:
    """读取 PDF 元数据"""
    file_path = resolve_path(params['path'])
    parse_page_info = params.get('parse_page_info', False)
    
    # 使用内存映射打开（不加载内容到内存）
    doc = fitz.open(file_path)
    
    try:
        metadata = doc.metadata
        page_count = len(doc)
        
        # 基础元数据
        basic_metadata = {
            'title': metadata.get('title') or None,
            'author': metadata.get('author') or None,
            'subject': metadata.get('subject') or None,
            'creator': metadata.get('creator') or None,
            'producer': metadata.get('producer') or None,
            'creation_date': metadata.get('creationDate') or None,
            'modification_date': metadata.get('modDate') or None,
            'keywords': metadata.get('keywords') or None
        }
        
        # 页面信息
        pages = []
        for i in range(page_count):
            page = doc[i]
            pages.append({
                'number': i + 1,
                'width': page.rect.width,
                'height': page.rect.height
            })
        
        result = {
            'success': True,
            'page_count': page_count,
            'metadata': basic_metadata,
            'basic_metadata': basic_metadata,
            'is_encrypted': doc.is_encrypted,
            'pages': pages
        }
        
        return result
    finally:
        doc.close()


def read_text(params: Dict[str, Any]) -> Dict[str, Any]:
    """提取文本内容"""
    file_path = resolve_path(params['path'])
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        start = (from_page or 1) - 1  # 转换为 0-based
        end = (to_page or total_pages) - 1
        
        # 边界检查
        start = max(0, start)
        end = min(total_pages - 1, end)
        
        texts = []
        for i in range(start, end + 1):
            page = doc[i]
            texts.append(page.get_text())
        
        return {
            'success': True,
            'text': '\n'.join(texts),
            'page_count': total_pages,
            'extracted_pages': list(range(start + 1, end + 2))
        }
    finally:
        doc.close()


def read_tables(params: Dict[str, Any]) -> Dict[str, Any]:
    """提取表格（PyMuPDF 通过 find_tables 支持）"""
    file_path = resolve_path(params['path'])
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        start = (from_page or 1) - 1
        end = (to_page or total_pages) - 1
        
        start = max(0, start)
        end = min(total_pages - 1, end)
        
        tables_result = []
        for i in range(start, end + 1):
            page = doc[i]
            page_tables = []
            
            # 尝试查找表格
            try:
                tabs = page.find_tables()
                if tabs and tabs.tables:
                    for tab in tabs.tables:
                        # 提取表格数据
                        table_data = tab.extract()
                        page_tables.append({
                            'rows': len(table_data) if table_data else 0,
                            'data': table_data
                        })
            except Exception:
                # 某些 PDF 可能不支持表格提取，静默忽略
                pass
            
            tables_result.append({
                'page_number': i + 1,
                'tables': page_tables
            })
        
        total_tables = sum(len(p['tables']) for p in tables_result)
        
        return {
            'success': True,
            'tables': tables_result,
            'total_tables': total_tables
        }
    finally:
        doc.close()


def read_images(params: Dict[str, Any]) -> Dict[str, Any]:
    """提取图片"""
    file_path = resolve_path(params['path'])
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    image_threshold = params.get('image_threshold', 80)
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        start = (from_page or 1) - 1
        end = (to_page or total_pages) - 1
        
        start = max(0, start)
        end = min(total_pages - 1, end)
        
        images_result = []
        for i in range(start, end + 1):
            page = doc[i]
            page_images = []
            
            # 获取页面图片列表
            img_list = page.get_images(full=True)
            
            for img_index, img in enumerate(img_list):
                xref = img[0]
                base_image = doc.extract_image(xref)
                
                if base_image:
                    width = base_image.get('width', 0)
                    height = base_image.get('height', 0)
                    
                    # 过滤小图片
                    if width >= image_threshold and height >= image_threshold:
                        image_data = base_image['image']
                        ext = base_image['ext']
                        
                        # 转换为 base64
                        data_url = f"data:image/{ext};base64,{base64.b64encode(image_data).decode()}"
                        
                        page_images.append({
                            'index': img_index + 1,
                            'width': width,
                            'height': height,
                            'data': data_url,
                            'data_url': data_url
                        })
            
            images_result.append({
                'page_number': i + 1,
                'images': page_images
            })
        
        total_images = sum(len(p['images']) for p in images_result)
        
        return {
            'success': True,
            'images': images_result,
            'total_images': total_images
        }
    finally:
        doc.close()


def read_render(params: Dict[str, Any]) -> Dict[str, Any]:
    """渲染页面为图片"""
    file_path = resolve_path(params['path'])
    output_dir = params.get('output_dir')
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    scale = params.get('scale', 1.5)
    desired_width = params.get('desired_width')
    prefix = params.get('prefix', 'page')
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        start = (from_page or 1) - 1
        end = (to_page or total_pages) - 1
        
        start = max(0, start)
        end = min(total_pages - 1, end)
        
        # 解析输出目录
        resolved_output_dir = None
        saved_files = []
        
        if output_dir:
            resolved_output_dir = resolve_path(output_dir)
            os.makedirs(resolved_output_dir, exist_ok=True)
        
        pages_result = []
        
        for i in range(start, end + 1):
            page = doc[i]
            
            # 计算矩阵
            if desired_width:
                # 根据期望宽度计算缩放
                rect = page.rect
                scale_factor = desired_width / rect.width
                mat = fitz.Matrix(scale_factor, scale_factor)
            else:
                mat = fitz.Matrix(scale, scale)
            
            # 渲染为图片
            pix = page.get_pixmap(matrix=mat)
            
            # 转换为 PNG 数据
            img_data = pix.tobytes('png')
            data_url = f"data:image/png;base64,{base64.b64encode(img_data).decode()}"
            
            # 保存到文件
            saved_path = None
            if resolved_output_dir:
                output_path = os.path.join(resolved_output_dir, f"{prefix}_{i + 1}.png")
                pix.save(output_path)
                saved_path = output_path
                saved_files.append(output_path)
            
            pages_result.append({
                'page_number': i + 1,
                'width': pix.width,
                'height': pix.height,
                'data_url': data_url,
                'saved_path': saved_path
            })
            
            pix = None  # 释放内存
        
        result = {
            'success': True,
            'pages': pages_result
        }
        
        if saved_files:
            result['saved_files'] = saved_files
            result['output_dir'] = resolved_output_dir
        
        return result
    finally:
        doc.close()


def read_markdown(params: Dict[str, Any]) -> Dict[str, Any]:
    """转换为 Markdown"""
    file_path = resolve_path(params['path'])
    output = params.get('output')
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    
    # 先提取文本
    text_result = read_text({
        'path': file_path,
        'from_page': from_page,
        'to_page': to_page
    })
    
    text = text_result['text']
    
    # 简单的 Markdown 转换
    lines = text.split('\n')
    processed_lines = []
    
    for line in lines:
        trimmed = line.strip()
        if trimmed and len(trimmed) < 50:
            # 可能是标题
            if trimmed[0].isupper() or '\u4e00' <= trimmed[0] <= '\u9fff':
                processed_lines.append(f"## {trimmed}")
                continue
        processed_lines.append(line)
    
    markdown = '\n'.join(processed_lines)
    
    if output:
        resolved_path = resolve_path(output)
        ensure_dir(resolved_path)
        with open(resolved_path, 'w', encoding='utf-8') as f:
            f.write(markdown)
        return {
            'success': True,
            'path': resolved_path,
            'markdown': markdown
        }
    
    return {
        'success': True,
        'markdown': markdown
    }


def read_fields(params: Dict[str, Any]) -> Dict[str, Any]:
    """检查表单字段"""
    file_path = resolve_path(params['path'])
    
    doc = fitz.open(file_path)
    
    try:
        fields = []
        # PyMuPDF 通过 get_fields 获取表单字段
        form_fields = doc.get_fields()
        
        if form_fields:
            for field_name, field_info in form_fields.items():
                fields.append({
                    'name': field_name,
                    'type': field_info.get('type', 'unknown')
                })
        
        return {
            'success': True,
            'has_fillable_fields': len(fields) > 0,
            'field_count': len(fields),
            'fields': fields
        }
    finally:
        doc.close()


# ==================== 写操作实现 ====================

def write_create(params: Dict[str, Any]) -> Dict[str, Any]:
    """创建 PDF"""
    output = resolve_path(params['output'])
    title = params.get('title')
    content = params.get('content', [])
    page_size = params.get('page_size', 'a4')
    
    # 页面尺寸
    sizes = {
        'a4': fitz.paper_rect('a4'),
        'letter': fitz.paper_rect('letter')
    }
    rect = sizes.get(page_size, sizes['a4'])
    
    doc = fitz.open()
    
    try:
        if title:
            doc.set_metadata({'title': title})
        
        for page_content in content:
            page = doc.new_page(width=rect.width, height=rect.height)
            
            # 简单文本渲染
            margin = 50
            y = margin
            line_height = 14
            
            for line in page_content.split('\n'):
                if y > rect.height - margin:
                    break
                page.insert_text(
                    (margin, y),
                    line,
                    fontsize=12,
                    fontname='helv'
                )
                y += line_height
        
        ensure_dir(output)
        doc.save(output)
        
        return {
            'success': True,
            'path': output,
            'page_count': len(doc)
        }
    finally:
        doc.close()


def write_merge(params: Dict[str, Any]) -> Dict[str, Any]:
    """合并 PDF"""
    paths = params.get('paths', [])
    output = resolve_path(params['output'])
    
    if len(paths) < 2:
        raise ValueError('At least 2 PDF files are required for merging')
    
    merged_doc = fitz.open()
    
    try:
        for file_path in paths:
            resolved_path = resolve_path(file_path)
            doc = fitz.open(resolved_path)
            
            # 插入所有页面
            merged_doc.insert_pdf(doc)
            doc.close()
        
        ensure_dir(output)
        merged_doc.save(output)
        
        return {
            'success': True,
            'path': output,
            'page_count': len(merged_doc)
        }
    finally:
        merged_doc.close()


def write_split(params: Dict[str, Any]) -> Dict[str, Any]:
    """拆分 PDF - 核心功能，内存高效"""
    file_path = resolve_path(params['path'])
    output_dir = resolve_path(params['output_dir'])
    pages_per_file = params.get('pages_per_file', 1)
    prefix = params.get('prefix', 'page')
    
    # 确保输出目录存在
    os.makedirs(output_dir, exist_ok=True)
    
    # 内存映射打开（不加载内容到内存）
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        output_files = []
        
        for start in range(0, total_pages, pages_per_file):
            end = min(start + pages_per_file, total_pages)
            
            # 创建新文档，只复制当前批次页面
            new_doc = fitz.open()
            try:
                new_doc.insert_pdf(doc, from_page=start, to_page=end - 1)
                
                # 保存
                output_path = os.path.join(output_dir, f"{prefix}_{start + 1}-{end}.pdf")
                new_doc.save(output_path)
                output_files.append(output_path)
            finally:
                new_doc.close()
        
        return {
            'success': True,
            'output_dir': output_dir,
            'files': output_files,
            'total_pages': total_pages,
            'files_created': len(output_files)
        }
    finally:
        doc.close()


def write_rotate(params: Dict[str, Any]) -> Dict[str, Any]:
    """旋转页面"""
    file_path = resolve_path(params['path'])
    output = resolve_path(params['output'])
    pages = params.get('pages', [])
    degrees = params.get('degrees', 90)
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        
        # 确定要旋转的页面
        if pages:
            pages_to_rotate = [p - 1 for p in pages if 1 <= p <= total_pages]
        else:
            pages_to_rotate = list(range(total_pages))
        
        # 旋转页面
        for page_idx in pages_to_rotate:
            page = doc[page_idx]
            page.set_rotation((page.rotation + degrees) % 360)
        
        ensure_dir(output)
        doc.save(output)
        
        return {
            'success': True,
            'path': output,
            'rotated_pages': [p + 1 for p in pages_to_rotate],
            'degrees': degrees
        }
    finally:
        doc.close()


def write_encrypt(params: Dict[str, Any]) -> Dict[str, Any]:
    """加密 PDF"""
    file_path = resolve_path(params['path'])
    output = resolve_path(params['output'])
    user_password = params.get('user_password')
    owner_password = params.get('owner_password')
    
    if not user_password:
        raise ValueError('user_password is required')
    
    doc = fitz.open(file_path)
    
    try:
        # 设置加密
        permissions = {
            'print': 1,
            'copy': 0,
            'modify': 0,
            'annotate': 0,
            'form': 0,
            'extract': 0,
            'assemble': 0,
            'print_hq': 0
        }
        
        ensure_dir(output)
        doc.save(
            output,
            encryption=fitz.PDF_ENCRYPT_AES_256,
            owner_pw=owner_password or user_password,
            user_pw=user_password,
            permissions=sum(permissions.values())
        )
        
        return {
            'success': True,
            'path': output,
            'encrypted': True
        }
    finally:
        doc.close()


def write_decrypt(params: Dict[str, Any]) -> Dict[str, Any]:
    """解密 PDF"""
    file_path = resolve_path(params['path'])
    output = resolve_path(params['output'])
    password = params.get('password')
    
    doc = fitz.open(file_path)
    
    try:
        # 如果文档加密，需要密码
        if doc.is_encrypted:
            if not password:
                raise ValueError('Password required for encrypted PDF')
            auth_result = doc.authenticate(password)
            if not auth_result:
                raise ValueError('Invalid password')
        
        ensure_dir(output)
        doc.save(output)
        
        return {
            'success': True,
            'path': output,
            'decrypted': True
        }
    finally:
        doc.close()


def write_watermark(params: Dict[str, Any]) -> Dict[str, Any]:
    """添加水印"""
    file_path = resolve_path(params['path'])
    output = resolve_path(params['output'])
    watermark = params.get('watermark')
    is_text = params.get('is_text', True)
    
    doc = fitz.open(file_path)
    
    try:
        for page in doc:
            rect = page.rect
            
            if is_text:
                # 文本水印
                # 计算中心位置
                center = (rect.width / 2, rect.height / 2)
                
                # 添加半透明文本
                page.insert_text(
                    center,
                    watermark,
                    fontsize=50,
                    color=(0.8, 0.8, 0.8),
                    rotate=45,
                    overlay=True
                )
            else:
                # PDF 水印
                watermark_path = resolve_path(watermark)
                watermark_doc = fitz.open(watermark_path)
                try:
                    watermark_page = watermark_doc[0]
                    # 将水印页面作为内容插入
                    page.show_pdf_page(rect, watermark_doc, 0, overlay=True)
                finally:
                    watermark_doc.close()
        
        ensure_dir(output)
        doc.save(output)
        
        return {
            'success': True,
            'path': output,
            'watermark_added': True
        }
    finally:
        doc.close()


# ==================== 技能入口 ====================

def read(params: Dict[str, Any]) -> Dict[str, Any]:
    """read 工具 - PDF 读取操作"""
    operation = params.get('operation')
    
    if not operation:
        raise ValueError('operation is required. Supported: metadata, text, tables, images, render, markdown, fields')
    
    operations = {
        'metadata': read_metadata,
        'text': read_text,
        'tables': read_tables,
        'images': read_images,
        'render': read_render,
        'markdown': read_markdown,
        'fields': read_fields
    }
    
    if operation not in operations:
        raise ValueError(f"Unknown operation: {operation}. Supported: {', '.join(operations.keys())}")
    
    return operations[operation](params)


def write(params: Dict[str, Any]) -> Dict[str, Any]:
    """write 工具 - PDF 写入操作"""
    operation = params.get('operation')
    
    if not operation:
        raise ValueError('operation is required. Supported: create, merge, split, rotate, encrypt, decrypt, watermark')
    
    operations = {
        'create': write_create,
        'merge': write_merge,
        'split': write_split,
        'rotate': write_rotate,
        'encrypt': write_encrypt,
        'decrypt': write_decrypt,
        'watermark': write_watermark
    }
    
    if operation not in operations:
        raise ValueError(f"Unknown operation: {operation}. Supported: {', '.join(operations.keys())}")
    
    return operations[operation](params)


def execute(tool_name: str, params: Dict[str, Any], context: Dict[str, Any] = None) -> Dict[str, Any]:
    """Skill execute function - called by skill-runner"""
    if tool_name == 'read':
        return read(params)
    elif tool_name == 'write':
        return write(params)
    else:
        raise ValueError(f"Unknown tool: {tool_name}. Supported tools: read, write")


# ==================== 主入口 ====================

if __name__ == '__main__':
    # 从标准输入读取参数
    try:
        input_data = sys.stdin.read()
        data = json.loads(input_data)
        
        tool_name = data.get('tool_name')
        params = data.get('params', {})
        context = data.get('context', {})
        
        result = execute(tool_name, params, context)
        
        # 输出结果
        print(json.dumps({
            'success': True,
            'data': result
        }))
    except Exception as e:
        error_info = {
            'success': False,
            'error': str(e),
            'stack': traceback.format_exc()
        }
        print(json.dumps(error_info))
        sys.exit(1)
