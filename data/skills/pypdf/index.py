#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PyPDF Skill - PDF 处理技能 (Python 版)
使用 PyMuPDF (fitz) 实现，内存效率高，适合处理大文件

工具设计：
- 14个独立工具，每个工具专注于单一功能

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


# ==================== 读取类工具实现 ====================

def read_metadata(params: Dict[str, Any]) -> Dict[str, Any]:
    """读取 PDF 元数据"""
    file_path = resolve_path(params['path'])
    parse_page_info = params.get('parse_page_info', False)
    
    doc = fitz.open(file_path)
    
    try:
        metadata = doc.metadata
        page_count = len(doc)
        
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


def extract_text(params: Dict[str, Any]) -> Dict[str, Any]:
    """提取文本内容"""
    file_path = resolve_path(params['path'])
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        start = (from_page - 1) if from_page else 0
        end = to_page if to_page else total_pages
        start = max(0, min(start, total_pages - 1))
        end = max(1, min(end, total_pages))
        
        pages_text = []
        for i in range(start, end):
            page = doc[i]
            text = page.get_text()
            pages_text.append({
                'page': i + 1,
                'text': text
            })
        
        full_text = '\n\n'.join([p['text'] for p in pages_text])
        
        return {
            'success': True,
            'pages': pages_text,
            'text': full_text,
            'page_count': len(pages_text)
        }
    finally:
        doc.close()


def extract_tables(params: Dict[str, Any]) -> Dict[str, Any]:
    """提取表格数据"""
    file_path = resolve_path(params['path'])
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        start = (from_page - 1) if from_page else 0
        end = to_page if to_page else total_pages
        start = max(0, min(start, total_pages - 1))
        end = max(1, min(end, total_pages))
        
        all_tables = []
        for i in range(start, end):
            page = doc[i]
            tables = page.find_tables()
            
            if tables and tables.tables:
                for table_idx, table in enumerate(tables.tables):
                    rows = []
                    for row in table.extract():
                        rows.append(row)
                    
                    all_tables.append({
                        'page': i + 1,
                        'table_index': table_idx,
                        'rows': rows,
                        'row_count': len(rows),
                        'column_count': len(rows[0]) if rows else 0
                    })
        
        return {
            'success': True,
            'tables': all_tables,
            'table_count': len(all_tables)
        }
    finally:
        doc.close()


def extract_images(params: Dict[str, Any]) -> Dict[str, Any]:
    """提取内嵌图片"""
    file_path = resolve_path(params['path'])
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    threshold = params.get('threshold', 80)
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        start = (from_page - 1) if from_page else 0
        end = to_page if to_page else total_pages
        start = max(0, min(start, total_pages - 1))
        end = max(1, min(end, total_pages))
        
        images_info = []
        for i in range(start, end):
            page = doc[i]
            image_list = page.get_images(full=True)
            
            for img_index, img in enumerate(image_list, start=1):
                xref = img[0]
                pix = fitz.Pixmap(doc, xref)
                
                if pix.width >= threshold and pix.height >= threshold:
                    if pix.n > 4:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    
                    img_data = pix.tobytes("png")
                    img_b64 = base64.b64encode(img_data).decode('utf-8')
                    
                    images_info.append({
                        'page': i + 1,
                        'index': img_index,
                        'width': pix.width,
                        'height': pix.height,
                        'data_url': f'data:image/png;base64,{img_b64}'
                    })
                
                pix = None
        
        return {
            'success': True,
            'images': images_info,
            'image_count': len(images_info)
        }
    finally:
        doc.close()


def render_pages(params: Dict[str, Any]) -> Dict[str, Any]:
    """渲染页面为图片"""
    file_path = resolve_path(params['path'])
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    output_dir = params.get('output_dir')
    scale = params.get('scale', 1.5)
    desired_width = params.get('desired_width')
    prefix = params.get('prefix', 'page')
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        start = (from_page - 1) if from_page else 0
        end = to_page if to_page else total_pages
        start = max(0, min(start, total_pages - 1))
        end = max(1, min(end, total_pages))
        
        if output_dir:
            output_dir = resolve_path(output_dir)
            os.makedirs(output_dir, exist_ok=True)
        
        rendered = []
        for i in range(start, end):
            page = doc[i]
            
            if desired_width:
                rect = page.rect
                scale = desired_width / rect.width
            
            mat = fitz.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=mat)
            
            img_data = pix.tobytes("png")
            img_b64 = base64.b64encode(img_data).decode('utf-8')
            data_url = f'data:image/png;base64,{img_b64}'
            
            result_item = {
                'page': i + 1,
                'width': pix.width,
                'height': pix.height,
                'data_url': data_url
            }
            
            if output_dir:
                filename = f'{prefix}_{i+1}-{i+1}.png'
                filepath = os.path.join(output_dir, filename)
                pix.save(filepath)
                result_item['file'] = filepath
            
            rendered.append(result_item)
            pix = None
        
        return {
            'success': True,
            'pages': rendered,
            'page_count': len(rendered),
            'output_dir': output_dir
        }
    finally:
        doc.close()


def to_markdown(params: Dict[str, Any]) -> Dict[str, Any]:
    """转换为 Markdown"""
    file_path = resolve_path(params['path'])
    from_page = params.get('from_page')
    to_page = params.get('to_page')
    output = params.get('output')
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        start = (from_page - 1) if from_page else 0
        end = to_page if to_page else total_pages
        start = max(0, min(start, total_pages - 1))
        end = max(1, min(end, total_pages))
        
        markdown_parts = []
        for i in range(start, end):
            page = doc[i]
            text = page.get_text()
            
            lines = text.split('\n')
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                if line.isupper() and len(line) < 100:
                    markdown_parts.append(f'## {line}')
                elif line[0].isdigit() and '.' in line[:10]:
                    markdown_parts.append(f'- {line}')
                else:
                    markdown_parts.append(line)
            
            markdown_parts.append('')
        
        markdown_text = '\n\n'.join(markdown_parts)
        
        if output:
            output_path = resolve_path(output)
            ensure_dir(output_path)
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(markdown_text)
        
        return {
            'success': True,
            'markdown': markdown_text,
            'page_count': end - start,
            'output_file': output
        }
    finally:
        doc.close()


def read_form_fields(params: Dict[str, Any]) -> Dict[str, Any]:
    """读取表单字段"""
    file_path = resolve_path(params['path'])
    
    doc = fitz.open(file_path)
    
    try:
        fields = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            widgets = page.widgets()
            
            if widgets:
                for widget in widgets:
                    field_info = {
                        'page': page_num + 1,
                        'name': widget.field_name,
                        'type': widget.field_type_string,
                        'value': widget.field_value,
                        'rect': {
                            'x0': widget.rect.x0,
                            'y0': widget.rect.y0,
                            'x1': widget.rect.x1,
                            'y1': widget.rect.y1
                        }
                    }
                    fields.append(field_info)
        
        return {
            'success': True,
            'fields': fields,
            'field_count': len(fields),
            'has_form': len(fields) > 0
        }
    finally:
        doc.close()


# ==================== 写入类工具实现 ====================

def create_pdf(params: Dict[str, Any]) -> Dict[str, Any]:
    """创建新 PDF"""
    output = resolve_path(params['output'])
    content = params['content']
    title = params.get('title', '')
    page_size = params.get('page_size', 'a4')
    
    ensure_dir(output)
    
    doc = fitz.open()
    
    try:
        size_map = {
            'a4': fitz.ISO_A4,
            'letter': fitz.ISO_LETTER
        }
        page_rect = size_map.get(page_size.lower(), fitz.ISO_A4)
        
        for text in content:
            page = doc.new_page(width=page_rect.width, height=page_rect.height)
            
            margin = 72
            text_rect = fitz.Rect(
                margin, margin,
                page_rect.width - margin,
                page_rect.height - margin
            )
            
            page.insert_textbox(
                text_rect,
                text,
                fontsize=12,
                fontname="helv"
            )
        
        if title:
            doc.set_metadata({'title': title})
        
        doc.save(output)
        
        return {
            'success': True,
            'path': output,
            'page_count': len(content),
            'title': title
        }
    finally:
        doc.close()


def merge_pdfs(params: Dict[str, Any]) -> Dict[str, Any]:
    """合并多个 PDF"""
    output = resolve_path(params['output'])
    paths = params['paths']
    
    ensure_dir(output)
    
    merged = fitz.open()
    
    try:
        for pdf_path in paths:
            resolved_path = resolve_path(pdf_path)
            doc = fitz.open(resolved_path)
            try:
                merged.insert_pdf(doc)
            finally:
                doc.close()
        
        merged.save(output)
        
        return {
            'success': True,
            'path': output,
            'source_count': len(paths),
            'total_pages': len(merged)
        }
    finally:
        merged.close()


def split_pdf(params: Dict[str, Any]) -> Dict[str, Any]:
    """拆分 PDF（内存高效）"""
    file_path = resolve_path(params['path'])
    output_dir = resolve_path(params['output_dir'])
    pages_per_file = params.get('pages_per_file', 1)
    prefix = params.get('prefix', 'page')
    
    os.makedirs(output_dir, exist_ok=True)
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        files_created = []
        
        for start in range(0, total_pages, pages_per_file):
            end = min(start + pages_per_file, total_pages)
            
            new_doc = fitz.open()
            try:
                new_doc.insert_pdf(doc, from_page=start, to_page=end-1)
                
                if pages_per_file == 1:
                    filename = f'{prefix}_{start+1}-{end}.pdf'
                else:
                    filename = f'{prefix}_{start+1}-{end}.pdf'
                
                output_path = os.path.join(output_dir, filename)
                new_doc.save(output_path)
                files_created.append(output_path)
            finally:
                new_doc.close()
        
        return {
            'success': True,
            'output_dir': output_dir,
            'files_created': files_created,
            'file_count': len(files_created),
            'pages_per_file': pages_per_file
        }
    finally:
        doc.close()


def rotate_pages(params: Dict[str, Any]) -> Dict[str, Any]:
    """旋转指定页面"""
    file_path = resolve_path(params['path'])
    output = resolve_path(params['output'])
    pages = params.get('pages', [])
    degrees = params.get('degrees', 90)
    
    ensure_dir(output)
    
    doc = fitz.open(file_path)
    
    try:
        total_pages = len(doc)
        pages_to_rotate = pages if pages else list(range(1, total_pages + 1))
        
        for page_num in pages_to_rotate:
            if 1 <= page_num <= total_pages:
                page = doc[page_num - 1]
                page.set_rotation(degrees)
        
        doc.save(output)
        
        return {
            'success': True,
            'path': output,
            'rotated_pages': pages_to_rotate,
            'degrees': degrees
        }
    finally:
        doc.close()


def encrypt_pdf(params: Dict[str, Any]) -> Dict[str, Any]:
    """加密 PDF"""
    file_path = resolve_path(params['path'])
    output = resolve_path(params['output'])
    user_password = params['user_password']
    owner_password = params.get('owner_password', user_password)
    
    ensure_dir(output)
    
    doc = fitz.open(file_path)
    
    try:
        permissions = {
            fitz.PDF_PERM_PRINT: 1,
            fitz.PDF_PERM_COPY: 1,
            fitz.PDF_PERM_ANNOTATE: 1
        }
        
        doc.save(
            output,
            encryption=fitz.PDF_ENCRYPT_AES_256,
            user_pw=user_password,
            owner_pw=owner_password,
            permissions=permissions
        )
        
        return {
            'success': True,
            'path': output,
            'encrypted': True
        }
    finally:
        doc.close()


def decrypt_pdf(params: Dict[str, Any]) -> Dict[str, Any]:
    """解密 PDF"""
    file_path = resolve_path(params['path'])
    output = resolve_path(params['output'])
    password = params['password']
    
    ensure_dir(output)
    
    doc = fitz.open(file_path)
    
    try:
        if doc.is_encrypted:
            result = doc.authenticate(password)
            if not result:
                return {
                    'success': False,
                    'error': 'Invalid password'
                }
        
        doc.save(output)
        
        return {
            'success': True,
            'path': output,
            'decrypted': True
        }
    finally:
        doc.close()


def add_watermark(params: Dict[str, Any]) -> Dict[str, Any]:
    """添加水印"""
    file_path = resolve_path(params['path'])
    output = resolve_path(params['output'])
    watermark = params['watermark']
    is_text = params.get('is_text', True)
    
    ensure_dir(output)
    
    doc = fitz.open(file_path)
    
    try:
        for page_num in range(len(doc)):
            page = doc[page_num]
            rect = page.rect
            
            if is_text:
                center = (rect.width / 2, rect.height / 2)
                page.insert_text(
                    center,
                    watermark,
                    fontsize=50,
                    color=(0.8, 0.8, 0.8),
                    overlay=True
                )
            else:
                watermark_path = resolve_path(watermark)
                watermark_doc = fitz.open(watermark_path)
                try:
                    page.show_pdf_page(rect, watermark_doc, 0, overlay=True)
                finally:
                    watermark_doc.close()
        
        doc.save(output)
        
        return {
            'success': True,
            'path': output,
            'watermark_added': True
        }
    finally:
        doc.close()


# ==================== 技能入口 ====================

def getTools():
    """获取工具清单 - 用于技能注册"""
    return [
        # 读取类工具
        {
            "name": "read_metadata",
            "description": "读取 PDF 元数据（标题、作者、页数等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    },
                    "parse_page_info": {
                        "type": "boolean",
                        "description": "解析每页详细信息（默认: false）"
                    }
                },
                "required": ["path"]
            }
        },
        {
            "name": "extract_text",
            "description": "提取 PDF 中的文本内容",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    },
                    "from_page": {
                        "type": "integer",
                        "description": "起始页（从1开始）"
                    },
                    "to_page": {
                        "type": "integer",
                        "description": "结束页（包含）"
                    }
                },
                "required": ["path"]
            }
        },
        {
            "name": "extract_tables",
            "description": "提取 PDF 中的表格数据",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    },
                    "from_page": {
                        "type": "integer",
                        "description": "起始页（从1开始）"
                    },
                    "to_page": {
                        "type": "integer",
                        "description": "结束页（包含）"
                    }
                },
                "required": ["path"]
            }
        },
        {
            "name": "extract_images",
            "description": "提取 PDF 中内嵌的图片",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    },
                    "from_page": {
                        "type": "integer",
                        "description": "起始页（从1开始）"
                    },
                    "to_page": {
                        "type": "integer",
                        "description": "结束页（包含）"
                    },
                    "threshold": {
                        "type": "integer",
                        "description": "图片最小尺寸阈值，像素（默认: 80）"
                    }
                },
                "required": ["path"]
            }
        },
        {
            "name": "render_pages",
            "description": "将 PDF 页面渲染为图片",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    },
                    "from_page": {
                        "type": "integer",
                        "description": "起始页（从1开始）"
                    },
                    "to_page": {
                        "type": "integer",
                        "description": "结束页（包含）"
                    },
                    "output_dir": {
                        "type": "string",
                        "description": "输出目录（不指定则只返回 dataUrl）"
                    },
                    "scale": {
                        "type": "number",
                        "description": "缩放比例（默认: 1.5，相当于 150 DPI）"
                    },
                    "desired_width": {
                        "type": "integer",
                        "description": "期望宽度（像素），设置后忽略 scale"
                    },
                    "prefix": {
                        "type": "string",
                        "description": "输出文件名前缀（默认: page）"
                    }
                },
                "required": ["path"]
            }
        },
        {
            "name": "to_markdown",
            "description": "将 PDF 转换为 Markdown 格式",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    },
                    "from_page": {
                        "type": "integer",
                        "description": "起始页（从1开始）"
                    },
                    "to_page": {
                        "type": "integer",
                        "description": "结束页（包含）"
                    },
                    "output": {
                        "type": "string",
                        "description": "输出 markdown 文件路径"
                    }
                },
                "required": ["path"]
            }
        },
        {
            "name": "read_form_fields",
            "description": "读取 PDF 表单字段信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    }
                },
                "required": ["path"]
            }
        },
        # 写入类工具
        {
            "name": "create_pdf",
            "description": "创建新的 PDF 文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "output": {
                        "type": "string",
                        "description": "输出 PDF 文件路径"
                    },
                    "content": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "文本内容数组（每项为一页）"
                    },
                    "title": {
                        "type": "string",
                        "description": "PDF 标题"
                    },
                    "page_size": {
                        "type": "string",
                        "enum": ["a4", "letter"],
                        "description": "页面大小（默认: a4）"
                    }
                },
                "required": ["output", "content"]
            }
        },
        {
            "name": "merge_pdfs",
            "description": "合并多个 PDF 文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "output": {
                        "type": "string",
                        "description": "输出 PDF 文件路径"
                    },
                    "paths": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要合并的 PDF 文件路径数组（至少2个）"
                    }
                },
                "required": ["output", "paths"]
            }
        },
        {
            "name": "split_pdf",
            "description": "拆分 PDF 为多个文件（内存高效）",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    },
                    "output_dir": {
                        "type": "string",
                        "description": "输出目录"
                    },
                    "pages_per_file": {
                        "type": "integer",
                        "description": "每个文件的页数（默认: 1）"
                    },
                    "prefix": {
                        "type": "string",
                        "description": "输出文件名前缀（默认: page）"
                    }
                },
                "required": ["path", "output_dir"]
            }
        },
        {
            "name": "rotate_pages",
            "description": "旋转 PDF 指定页面",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    },
                    "output": {
                        "type": "string",
                        "description": "输出 PDF 文件路径"
                    },
                    "pages": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "要旋转的页码（从1开始，空则旋转所有）"
                    },
                    "degrees": {
                        "type": "integer",
                        "enum": [90, 180, 270],
                        "description": "旋转角度（默认: 90）"
                    }
                },
                "required": ["path", "output"]
            }
        },
        {
            "name": "encrypt_pdf",
            "description": "加密 PDF 文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    },
                    "output": {
                        "type": "string",
                        "description": "输出 PDF 文件路径"
                    },
                    "user_password": {
                        "type": "string",
                        "description": "打开 PDF 的密码"
                    },
                    "owner_password": {
                        "type": "string",
                        "description": "编辑密码（默认使用 user_password）"
                    }
                },
                "required": ["path", "output", "user_password"]
            }
        },
        {
            "name": "decrypt_pdf",
            "description": "解密 PDF 文件",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    },
                    "output": {
                        "type": "string",
                        "description": "输出 PDF 文件路径"
                    },
                    "password": {
                        "type": "string",
                        "description": "当前密码"
                    }
                },
                "required": ["path", "output", "password"]
            }
        },
        {
            "name": "add_watermark",
            "description": "为 PDF 添加水印",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "PDF 文件路径"
                    },
                    "output": {
                        "type": "string",
                        "description": "输出 PDF 文件路径"
                    },
                    "watermark": {
                        "type": "string",
                        "description": "水印文本或水印 PDF 路径"
                    },
                    "is_text": {
                        "type": "boolean",
                        "description": "true 为文本水印，false 为 PDF 路径（默认: true）"
                    }
                },
                "required": ["path", "output", "watermark"]
            }
        }
    ]


# 技能执行入口 - 适配 skill-runner.js 调用协议
def execute(tool_name: str, params: Dict[str, Any], context: Dict[str, Any] = None) -> Dict[str, Any]:
    """技能执行入口 - 由 skill-runner.js 调用"""
    return dispatch(tool_name, params)


# 工具映射表
tool_map = {
    'read_metadata': read_metadata,
    'extract_text': extract_text,
    'extract_tables': extract_tables,
    'extract_images': extract_images,
    'render_pages': render_pages,
    'to_markdown': to_markdown,
    'read_form_fields': read_form_fields,
    'create_pdf': create_pdf,
    'merge_pdfs': merge_pdfs,
    'split_pdf': split_pdf,
    'rotate_pages': rotate_pages,
    'encrypt_pdf': encrypt_pdf,
    'decrypt_pdf': decrypt_pdf,
    'add_watermark': add_watermark
}


def dispatch(tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """分发工具调用"""
    if tool_name not in tool_map:
        return {
            'success': False,
            'error': f'Unknown tool: {tool_name}'
        }
    
    try:
        func = tool_map[tool_name]
        return func(params)
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }


# 命令行入口
if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({
            'success': False,
            'error': 'Usage: python index.py <tool_name> [params_json]'
        }))
        sys.exit(1)
    
    tool_name = sys.argv[1]
    params = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    
    result = dispatch(tool_name, params)
    print(json.dumps(result, ensure_ascii=False))
