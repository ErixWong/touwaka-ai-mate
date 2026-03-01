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

#### read_file

Read file content with mode parameter.

**Parameters:**
- `path` (string, required): File path
- `mode` (string, optional): Read mode - `"lines"` (default) or `"bytes"`
- `from` (number, optional): Start line for lines mode (default: 1)
- `lines` (number, optional): Number of lines for lines mode (default: 100)
- `offset` (number, optional): Start byte for bytes mode (default: 0)
- `bytes` (number, optional): Bytes to read for bytes mode (default: 50000)

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

Write content to a file with optional append mode.

**Parameters:**
- `path` (string, required): File path
- `content` (string, required): Content to write
- `mode` (string, optional): Write mode - `"write"` (default, overwrite) or `"append"`

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

#### transfer

Copy or move a file.

**Parameters:**
- `source` (string, required): Source path
- `destination` (string, required): Destination path
- `operation` (string, optional): Operation - `"copy"` (default) or `"move"`

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
// Read a file (lines mode)
{ "tool": "read_file", "params": { "path": "data/example.txt" } }

// Read file in bytes mode
{ "tool": "read_file", "params": { "path": "data/binary.bin", "mode": "bytes", "bytes": 1000 } }

// Search in files
{ "tool": "grep", "params": { "pattern": "TODO", "path": "data/src" } }

// Write a file
{ "tool": "write_file", "params": { "path": "data/output.txt", "content": "Hello!" } }

// Append to a file
{ "tool": "write_file", "params": { "path": "data/log.txt", "content": "New entry\n", "mode": "append" } }

// Copy a file
{ "tool": "transfer", "params": { "source": "data/file.txt", "destination": "data/backup.txt", "operation": "copy" } }

// Move a file
{ "tool": "transfer", "params": { "source": "data/old.txt", "destination": "data/new.txt", "operation": "move" } }
```
