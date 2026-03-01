---
name: file-operations
description: File system operations including read, write, search, and manage files. Use when you need to work with files in the data directory.
argument-hint: "[operation] [path]"
user-invocable: true
allowed-tools:
  - Bash(cat *)
  - Bash(ls *)
  - Bash(grep *)
  - Bash(find *)
---

# File Operations

Complete file system operations for reading, writing, searching, and managing files.

## Tools

### Reading Files

#### read_lines
Read file content line by line.

**Parameters:**
- `path` (string, required): File path
- `from` (number, optional): Start line (default: 1)
- `lines` (number, optional): Number of lines to read (default: 100)

#### read_bytes
Read file content by bytes.

**Parameters:**
- `path` (string, required): File path
- `offset` (number, optional): Start byte (default: 0)
- `bytes` (number, optional): Bytes to read (default: 50000)

#### list_files
List directory contents.

**Parameters:**
- `path` (string, required): Directory path
- `recursive` (boolean, optional): List recursively (default: false)

### Searching

#### search_in_file
Search text in a single file.

**Parameters:**
- `path` (string, required): File path
- `pattern` (string, required): Search pattern
- `ignore_case` (boolean, optional): Case insensitive (default: true)

#### grep
Search text across multiple files.

**Parameters:**
- `pattern` (string, required): Search pattern
- `path` (string, optional): Directory path (default: current)
- `file_pattern` (string, optional): File pattern (default: "*")

### Writing Files

#### write_file
Write content to a file.

**Parameters:**
- `path` (string, required): File path
- `content` (string, required): Content to write

#### append_file
Append content to a file.

**Parameters:**
- `path` (string, required): File path
- `content` (string, required): Content to append

#### replace_in_file
Replace text in a file.

**Parameters:**
- `path` (string, required): File path
- `old` (string, required): Text to replace
- `new` (string, required): Replacement text

#### insert_at_line
Insert content at a specific line.

**Parameters:**
- `path` (string, required): File path
- `line` (number, required): Line number
- `content` (string, required): Content to insert

#### delete_lines
Delete specific lines from a file.

**Parameters:**
- `path` (string, required): File path
- `from` (number, required): Start line
- `to` (number, optional): End line (default: from)

### File Management

#### copy_file
Copy a file.

**Parameters:**
- `source` (string, required): Source path
- `destination` (string, required): Destination path

#### move_file
Move or rename a file.

**Parameters:**
- `source` (string, required): Source path
- `destination` (string, required): Destination path

#### delete_file
Delete a file or directory.

**Parameters:**
- `path` (string, required): Path to delete

#### create_dir
Create a directory.

**Parameters:**
- `path` (string, required): Directory path

## Security

All file operations are restricted to the `data` directory by default.
Use absolute paths carefully.

## Examples

```javascript
// Read a file
{ "tool": "read_lines", "params": { "path": "data/example.txt" } }

// Search in files
{ "tool": "grep", "params": { "pattern": "TODO", "path": "data/src" } }

// Write a file
{ "tool": "write_file", "params": { "path": "data/output.txt", "content": "Hello!" } }
```