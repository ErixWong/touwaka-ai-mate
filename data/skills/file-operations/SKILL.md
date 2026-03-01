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

#### read_file (recommended)

Unified file reading with mode parameter.

**Parameters:**
- `path` (string, required): File path
- `mode` (string, optional): Read mode - `"lines"` (default) or `"bytes"`
- `from` (number, optional): Start line for lines mode (default: 1)
- `lines` (number, optional): Number of lines to read for lines mode (default: 100)
- `offset` (number, optional): Start byte for bytes mode (default: 0)
- `bytes` (number, optional): Bytes to read for bytes mode (default: 50000)

#### read_lines (legacy)

Read file content line by line. *Deprecated: Use `read_file` with `mode: "lines"` instead.*

**Parameters:**
- `path` (string, required): File path
- `from` (number, optional): Start line (default: 1)
- `lines` (number, optional): Number of lines to read (default: 100)

#### read_bytes (legacy)

Read file content by bytes. *Deprecated: Use `read_file` with `mode: "bytes"` instead.*

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

#### write_file (enhanced)

Write content to a file with optional append mode.

**Parameters:**
- `path` (string, required): File path
- `content` (string, required): Content to write
- `mode` (string, optional): Write mode - `"write"` (default, overwrite) or `"append"`

#### append_file (legacy)

Append content to a file. *Deprecated: Use `write_file` with `mode: "append"` instead.*

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

#### transfer (recommended)

Unified file transfer for copy and move operations.

**Parameters:**
- `source` (string, required): Source path
- `destination` (string, required): Destination path
- `operation` (string, optional): Operation - `"copy"` (default) or `"move"`

#### copy_file (legacy)

Copy a file. *Deprecated: Use `transfer` with `operation: "copy"` instead.*

**Parameters:**
- `source` (string, required): Source path
- `destination` (string, required): Destination path

#### move_file (legacy)

Move or rename a file. *Deprecated: Use `transfer` with `operation: "move"` instead.*

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
// Read a file (new unified API)
{ "tool": "read_file", "params": { "path": "data/example.txt" } }

// Read file in bytes mode
{ "tool": "read_file", "params": { "path": "data/binary.bin", "mode": "bytes", "bytes": 1000 } }

// Search in files
{ "tool": "grep", "params": { "pattern": "TODO", "path": "data/src" } }

// Write a file
{ "tool": "write_file", "params": { "path": "data/output.txt", "content": "Hello!" } }

// Append to a file (new API)
{ "tool": "write_file", "params": { "path": "data/log.txt", "content": "New entry\n", "mode": "append" } }

// Copy a file (new unified API)
{ "tool": "transfer", "params": { "source": "data/file.txt", "destination": "data/backup.txt", "operation": "copy" } }

// Move a file (new unified API)
{ "tool": "transfer", "params": { "source": "data/old.txt", "destination": "data/new.txt", "operation": "move" } }
```

## Migration Guide

| Legacy Tool | New Tool | Notes |
|-------------|----------|-------|
| `read_lines` | `read_file` | Add `mode: "lines"` |
| `read_bytes` | `read_file` | Add `mode: "bytes"` |
| `append_file` | `write_file` | Add `mode: "append"` |
| `copy_file` | `transfer` | Add `operation: "copy"` |
| `move_file` | `transfer` | Add `operation: "move"` |

Legacy tools are still supported for backward compatibility.
