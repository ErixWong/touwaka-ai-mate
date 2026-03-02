#!/usr/bin/env python3
"""
PDF 转 Markdown 工具
将 PDF 文件转换为 Markdown 格式，并提取图片

用法:
    python pdf_to_markdown.py <input.pdf> [output_dir] [--no-images]

参数:
    input.pdf     - 输入的 PDF 文件路径
    output_dir    - 输出目录（可选，默认与 PDF 同目录）
    --no-images   - 不提取图片（可选）

输出:
    - {pdf_name}.md  - Markdown 文件
    - images/        - 图片目录（如果提取图片）
"""

import os
import sys
import re
import argparse

# 尝试导入 PDF 库
try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False

try:
    from pypdf import PdfReader
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def clean_text(text):
    """清理提取的文本"""
    # 移除多余的空行
    text = re.sub(r'\n{3,}', '\n\n', text)
    # 移除行尾空格
    text = '\n'.join(line.rstrip() for line in text.split('\n'))
    return text


def convert_with_pdfplumber(file_path, image_dir, pages, pdf_name):
    """使用 pdfplumber 转换 PDF 为 Markdown"""
    markdown_parts = []
    all_images = []
    image_counter = 0
    
    with pdfplumber.open(file_path) as pdf:
        page_indices = pages if pages else range(len(pdf.pages))
        
        for i in page_indices:
            if i < 0 or i >= len(pdf.pages):
                continue
            
            page = pdf.pages[i]
            
            # 添加页面分隔
            markdown_parts.append(f'\n## 第 {i + 1} 页\n\n')
            
            # 提取文本
            text = page.extract_text() or ''
            if text.strip():
                text = clean_text(text)
                markdown_parts.append(text)
                markdown_parts.append('\n')
            
            # 提取图片
            if image_dir and HAS_PIL:
                if hasattr(page, 'images') and page.images:
                    for img_info in page.images:
                        try:
                            # 裁剪图片区域
                            x0 = img_info.get('x0', 0)
                            y0 = img_info.get('top', 0)
                            x1 = img_info.get('x1', page.width)
                            y1 = img_info.get('bottom', page.height)
                            
                            # 限制在页面范围内
                            x0 = max(0, min(x0, page.width))
                            y0 = max(0, min(y0, page.height))
                            x1 = max(0, min(x1, page.width))
                            y1 = max(0, min(y1, page.height))
                            
                            if x1 > x0 and y1 > y0:
                                # 裁剪区域
                                cropped = page.crop((x0, y0, x1, y1))
                                im = cropped.to_image()
                                
                                # 保存图片
                                image_counter += 1
                                image_filename = f'{pdf_name}_p{i+1}_img{image_counter}.png'
                                image_path = os.path.join(image_dir, image_filename)
                                im.save(image_path)
                                
                                # 添加到 Markdown
                                rel_path = f'images/{image_filename}'
                                markdown_parts.append(f'\n![图片 {image_counter}]({rel_path})\n\n')
                                
                                all_images.append({
                                    'page': i + 1,
                                    'index': image_counter,
                                    'path': image_path,
                                    'relative_path': rel_path
                                })
                        except Exception as e:
                            print(f"Warning: Failed to extract image on page {i+1}: {e}", file=sys.stderr)
            
            markdown_parts.append('\n---\n')
    
    return ''.join(markdown_parts), all_images


def convert_with_pypdf(file_path, image_dir, pages, pdf_name):
    """使用 pypdf 转换 PDF 为 Markdown"""
    markdown_parts = []
    all_images = []
    image_counter = 0
    
    reader = PdfReader(file_path)
    page_indices = pages if pages else range(len(reader.pages))
    
    for i in page_indices:
        if i < 0 or i >= len(reader.pages):
            continue
        
        page = reader.pages[i]
        
        # 添加页面分隔
        markdown_parts.append(f'\n## 第 {i + 1} 页\n\n')
        
        # 提取文本
        text = page.extract_text() or ''
        if text.strip():
            text = clean_text(text)
            markdown_parts.append(text)
            markdown_parts.append('\n')
        
        # 提取图片
        if image_dir and HAS_PIL:
            if '/XObject' in page.get('/Resources', {}):
                xobject = page['/Resources']['/XObject']
                if hasattr(xobject, 'get_object'):
                    xobject = xobject.get_object()
                
                for obj_name in xobject:
                    obj = xobject[obj_name]
                    if hasattr(obj, 'get') and obj.get('/Subtype') == '/Image':
                        try:
                            data = obj.get_data()
                            if data:
                                image_counter += 1
                                image_filename = f'{pdf_name}_p{i+1}_img{image_counter}.png'
                                image_path = os.path.join(image_dir, image_filename)
                                
                                with open(image_path, 'wb') as f:
                                    f.write(data)
                                
                                rel_path = f'images/{image_filename}'
                                markdown_parts.append(f'\n![图片 {image_counter}]({rel_path})\n\n')
                                
                                all_images.append({
                                    'page': i + 1,
                                    'index': image_counter,
                                    'path': image_path,
                                    'relative_path': rel_path
                                })
                        except Exception as e:
                            print(f"Warning: Failed to extract image on page {i+1}: {e}", file=sys.stderr)
        
        markdown_parts.append('\n---\n')
    
    return ''.join(markdown_parts), all_images


def pdf_to_markdown(file_path, output_dir=None, extract_images=True, pages=None):
    """
    将 PDF 转换为 Markdown 格式
    
    Args:
        file_path: PDF 文件路径
        output_dir: 输出目录（默认与 PDF 同目录）
        extract_images: 是否提取图片
        pages: 要转换的页码列表（默认全部）
    
    Returns:
        dict: 转换结果
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f'PDF file not found: {file_path}')
    
    # 输出目录
    pdf_dir = os.path.dirname(file_path)
    pdf_name = os.path.splitext(os.path.basename(file_path))[0]
    output_dir = output_dir or pdf_dir
    
    # 图片目录
    image_dir_name = 'images'
    image_dir = os.path.join(output_dir, image_dir_name) if extract_images else None
    
    # 创建输出目录
    if extract_images and image_dir and not os.path.exists(image_dir):
        os.makedirs(image_dir, exist_ok=True)
    
    result = {
        'pdf_file': file_path,
        'output_dir': output_dir,
        'markdown_file': os.path.join(output_dir, f'{pdf_name}.md'),
        'images': [],
        'pages_processed': 0
    }
    
    # 收集所有 Markdown 内容
    markdown_parts = []
    
    # 添加标题
    markdown_parts.append(f'# {pdf_name}\n\n')
    markdown_parts.append(f'> 来源: {os.path.basename(file_path)}\n\n')
    markdown_parts.append('---\n\n')
    
    if HAS_PDFPLUMBER:
        md_content, images = convert_with_pdfplumber(
            file_path, image_dir, pages, pdf_name
        )
        markdown_parts.append(md_content)
        result['images'].extend(images)
        result['method'] = 'pdfplumber'
    elif HAS_PYPDF:
        md_content, images = convert_with_pypdf(
            file_path, image_dir, pages, pdf_name
        )
        markdown_parts.append(md_content)
        result['images'].extend(images)
        result['method'] = 'pypdf'
    else:
        raise ImportError('No PDF library available. Please install pypdf or pdfplumber.')
    
    # 写入 Markdown 文件
    full_markdown = ''.join(markdown_parts)
    with open(result['markdown_file'], 'w', encoding='utf-8') as f:
        f.write(full_markdown)
    
    result['markdown_length'] = len(full_markdown)
    result['image_count'] = len(result['images'])
    
    return result


def main():
    parser = argparse.ArgumentParser(
        description='将 PDF 转换为 Markdown 格式',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
    python pdf_to_markdown.py document.pdf
    python pdf_to_markdown.py document.pdf ./output
    python pdf_to_markdown.py document.pdf ./output --no-images
        """
    )
    parser.add_argument('input', help='输入的 PDF 文件路径')
    parser.add_argument('output', nargs='?', default=None, help='输出目录（可选）')
    parser.add_argument('--no-images', action='store_true', help='不提取图片')
    
    args = parser.parse_args()
    
    # 检查依赖
    if not HAS_PDFPLUMBER and not HAS_PYPDF:
        print("Error: 需要安装 pdfplumber 或 pypdf 库", file=sys.stderr)
        print("  pip install pdfplumber", file=sys.stderr)
        sys.exit(1)
    
    try:
        result = pdf_to_markdown(
            args.input,
            args.output,
            extract_images=not args.no_images
        )
        
        print(f"[OK] 转换完成!")
        print(f"   Markdown: {result['markdown_file']}")
        print(f"   文本长度: {result['markdown_length']} 字符")
        print(f"   提取图片: {result['image_count']} 张")
        print(f"   使用库: {result['method']}")
        
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
