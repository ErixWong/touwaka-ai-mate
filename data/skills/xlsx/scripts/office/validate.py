"""
Command line tool to validate Office document XML files against XSD schemas and tracked changes.

Usage:
    python validate.py <path> [--original <original_file>] [--auto-repair] [--author NAME]

The first argument can be either:
- An unpacked directory containing the Office document XML files
- A packed Office file (.docx/.pptx/.xlsx) which will be unpacked to a temp directory

Auto-repair fixes:
- paraId/durableId values that exceed OOXML limits
- Missing xml:space="preserve" on w:t elements with whitespace
"""

import argparse
import sys
import tempfile
import zipfile
from pathlib import Path

from validators import DOCXSchemaValidator, PPTXSchemaValidator, RedliningValidator


def main():
    parser = argparse.ArgumentParser(description="Validate Office document XML files")
    parser.add_argument(
        "path",
        help="Path to unpacked directory or packed Office file (.docx/.pptx/.xlsx)",
    )
    parser.add_argument(
        "--original",
        required=False,
        default=None,
        help="Path to original file (.docx/.pptx/.xlsx). If omitted, all XSD errors are reported and redlining validation is skipped.",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose output",
    )
    parser.add_argument(
        "--auto-repair",
        action="store_true",
        help="Automatically repair common issues (hex IDs, whitespace preservation)",
    )
    parser.add_argument(
        "--author",
        default="Claude",
        help="Author name for redlining validation (default: Claude)",
    )
    args = parser.parse_args()

    path = Path(args.path)
    assert path.exists(), f"Error: {path} does not exist"

    original_file = None
    if args.original:
        original_file = Path(args.original)
        assert original_file.is_file(), f"Error: {original_file} is not a file"
        assert original_file.suffix.lower() in [".docx", ".pptx", ".xlsx"], (
            f"Error: {original_file} must be a .docx, .pptx, or .xlsx file"
        )

    file_extension = (original_file or path).suffix.lower()
    assert file_extension in [".docx", ".pptx", ".xlsx"], (
        f"Error: Cannot determine file type from {path}. Use --original or provide a .docx/.pptx/.xlsx file."
    )

    if path.is_file() and path.suffix.lower() in [".docx", ".pptx", ".xlsx"]:
        temp_dir = tempfile.mkdtemp()
        with zipfile.ZipFile(path, "r") as zf:
            zf.extractall(temp_dir)
        unpacked_dir = Path(temp_dir)
    else:
        assert path.is_dir(), f"Error: {path} is not a directory or Office file"
        unpacked_dir = path

    match file_extension:
        case ".docx":
            validators = [
                DOCXSchemaValidator(unpacked_dir, original_file, verbose=args.verbose),
            ]
            if original_file:
                validators.append(
                    RedliningValidator(unpacked_dir, original_file, verbose=args.verbose, author=args.author)  
                )
        case ".pptx":
            validators = [
                PPTXSchemaValidator(unpacked_dir, original_file, verbose=args.verbose),
            ]
        case _:
            print(f"Error: Validation not supported for file type {file_extension}")
            sys.exit(1)

    if args.auto_repair:
        total_repairs = sum(v.repair() for v in validators)
        if total_repairs:
            print(f"Auto-repaired {total_repairs} issue(s)")

    success = all(v.validate() for v in validators)

    if success:
        print("All validations PASSED!")

    sys.exit(0 if success else 1)


def execute(tool_name, params, context=None):
    """
    Execute validate tool.
    
    Args:
        tool_name: Name of the tool (e.g., 'validate', 'xlsx_validate')
        params: Tool parameters including 'path', 'original', 'auto_repair', 'verbose'
        context: Execution context (optional)
    
    Returns:
        dict with 'success', 'message', 'repairs'
    """
    if tool_name in ('validate', 'xlsx_validate'):
        path = params.get('path')
        original = params.get('original')
        auto_repair = params.get('auto_repair', False)
        verbose = params.get('verbose', False)
        author = params.get('author', 'Claude')
        
        if not path:
            return {'success': False, 'error': 'path is required'}
        
        path_obj = Path(path)
        if not path_obj.exists():
            return {'success': False, 'error': f'Path {path} does not exist'}
        
        # Determine file extension
        original_file = Path(original) if original else None
        file_extension = (original_file or path_obj).suffix.lower()
        
        if file_extension not in [".docx", ".pptx", ".xlsx"]:
            return {'success': False, 'error': 'Cannot determine file type. Use --original or provide a .docx/.pptx/.xlsx file.'}
        
        # Unpack if needed
        if path_obj.is_file() and path_obj.suffix.lower() in [".docx", ".pptx", ".xlsx"]:
            import tempfile
            temp_dir = tempfile.mkdtemp()
            with zipfile.ZipFile(path_obj, "r") as zf:
                zf.extractall(temp_dir)
            unpacked_dir = Path(temp_dir)
        else:
            if not path_obj.is_dir():
                return {'success': False, 'error': f'{path} is not a directory or Office file'}
            unpacked_dir = path_obj
        
        # Select validators
        validators = []
        if file_extension == ".docx":
            validators = [DOCXSchemaValidator(unpacked_dir, original_file, verbose=verbose)]
            if original_file:
                validators.append(RedliningValidator(unpacked_dir, original_file, verbose=verbose, author=author))
        elif file_extension == ".pptx":
            validators = [PPTXSchemaValidator(unpacked_dir, original_file, verbose=verbose)]
        
        # Run repairs and validation
        total_repairs = 0
        if auto_repair:
            total_repairs = sum(v.repair() for v in validators)
        
        success = all(v.validate() for v in validators)
        
        return {
            'success': success,
            'repairs': total_repairs,
            'message': 'All validations PASSED!' if success else 'Validation failed'
        }
    
    raise ValueError(f"Unknown tool: {tool_name}")


if __name__ == "__main__":
    main()
