#!/usr/bin/env python3
"""
Convert PPT extracted content to Wiki.js pages.

Usage:
    python ppt_to_wiki.py \
        --content tmp/ppt_extracted/content.md \
        --images tmp/ppt_extracted/slides_png_hd2 \
        --output-path "ppt/presentation-name" \
        --title "Presentation Title"

Or with base64 embedded images:
    python ppt_to_wiki.py \
        --content tmp/ppt_extracted/content.md \
        --images tmp/ppt_extracted/slides_png_hd2 \
        --output-path "ppt/presentation-name" \
        --title "Presentation Title" \
        --embed-images
"""

import os
import sys
import base64
import argparse
from pathlib import Path

# Add scripts directory to path for importing wikijs_client
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wikijs_client import WikiJSClient


def image_to_base64(image_path: str) -> str:
    """Convert image to base64 data URI."""
    with open(image_path, 'rb') as f:
        data = f.read()
        encoded = base64.b64encode(data).decode('utf-8')
    
    ext = Path(image_path).suffix.lower()
    mime_types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
    }
    mime = mime_types.get(ext, 'image/png')
    return f'data:{mime};base64,{encoded}'


def create_images_section(images_dir: str, embed: bool = False) -> str:
    """Create markdown section with slide images."""
    if not images_dir or not os.path.exists(images_dir):
        return ""
    
    # Get all image files sorted
    image_files = sorted([
        f for f in os.listdir(images_dir)
        if f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg'))
    ])
    
    if not image_files:
        return ""
    
    section = f"## 📊 PPT幻灯片预览\n\n> 共 {len(image_files)} 页\n\n"
    
    for i, img_file in enumerate(image_files, 1):
        img_path = os.path.join(images_dir, img_file)
        
        if embed:
            # Embed as base64
            try:
                data_uri = image_to_base64(img_path)
                section += f"### 幻灯片 {i}\n\n![Slide {i}]({data_uri})\n\n"
            except Exception as e:
                section += f"### 幻灯片 {i}\n\n(Error loading image: {e})\n\n"
        else:
            # Just reference the image file
            section += f"### 幻灯片 {i}\n\n![Slide {i}]({img_file})\n\n"
        
        section += "---\n\n"
    
    return section


def convert_ppt_to_wiki(
    content_file: str,
    images_dir: str,
    output_path: str,
    title: str,
    embed_images: bool = False,
    locale: str = "en",
    tags: str = "ppt,presentation"
) -> dict:
    """
    Convert PPT extracted content to Wiki.js page.
    
    Args:
        content_file: Path to content.md file
        images_dir: Path to slides images directory
        output_path: Wiki.js page path (e.g., "ppt/my-presentation")
        title: Page title
        embed_images: Whether to embed images as base64
        locale: Page locale
        tags: Comma-separated tags
    
    Returns:
        API response dict
    """
    # Read content
    with open(content_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Build full page content
    images_section = create_images_section(images_dir, embed_images)
    
    full_content = f"""# {title}

> 本文档由PPT自动转换生成

{images_section}

## 📝 详细内容

{content}
"""
    
    # Create Wiki.js client
    client = WikiJSClient()
    
    # Create page
    tag_list = [t.strip() for t in tags.split(',') if t.strip()]
    
    result = client.create_page(
        path=output_path,
        title=title,
        content=full_content,
        locale=locale,
        description=f"PPT转换 - {title}",
        tags=tag_list,
        is_published=True,
        editor="markdown"
    )
    
    return result


def main():
    parser = argparse.ArgumentParser(
        description='Convert PPT extracted content to Wiki.js page'
    )
    parser.add_argument(
        '--content', '-c',
        required=True,
        help='Path to content.md file'
    )
    parser.add_argument(
        '--images', '-i',
        help='Path to slides images directory'
    )
    parser.add_argument(
        '--output-path', '-o',
        required=True,
        help='Wiki.js page path (e.g., "ppt/my-presentation")'
    )
    parser.add_argument(
        '--title', '-t',
        required=True,
        help='Page title'
    )
    parser.add_argument(
        '--embed-images', '-e',
        action='store_true',
        help='Embed images as base64 (creates self-contained page)'
    )
    parser.add_argument(
        '--locale', '-l',
        default='en',
        help='Page locale (default: en)'
    )
    parser.add_argument(
        '--tags',
        default='ppt,presentation',
        help='Comma-separated tags (default: ppt,presentation)'
    )
    
    args = parser.parse_args()
    
    # Validate inputs
    if not os.path.exists(args.content):
        print(f"Error: Content file not found: {args.content}")
        sys.exit(1)
    
    if args.images and not os.path.exists(args.images):
        print(f"Warning: Images directory not found: {args.images}")
        args.images = None
    
    print(f"Converting PPT to Wiki.js page...")
    print(f"  Content: {args.content}")
    print(f"  Images: {args.images or 'None'}")
    print(f"  Output: {args.output_path}")
    print(f"  Title: {args.title}")
    print(f"  Embed images: {args.embed_images}")
    
    result = convert_ppt_to_wiki(
        content_file=args.content,
        images_dir=args.images,
        output_path=args.output_path,
        title=args.title,
        embed_images=args.embed_images,
        locale=args.locale,
        tags=args.tags
    )
    
    # Check result
    response = result.get("data", {}).get("pages", {}).get("create", {})
    response_result = response.get("responseResult", {})
    
    if response_result.get("succeeded"):
        page = response.get("page", {})
        print(f"\n✅ Success!")
        print(f"   Page ID: {page.get('id')}")
        print(f"   Path: {page.get('path')}")
        print(f"   Title: {page.get('title')}")
    else:
        print(f"\n❌ Failed: {response_result.get('message')}")
        sys.exit(1)


if __name__ == "__main__":
    main()
