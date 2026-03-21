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

### File System Information

#### fs_info

Get detailed metadata about a file or directory. **Recommended to call before other operations** to understand what you're working with.

**Parameters:**
- `path` (string, required): File or directory path
- `include_content_preview` (boolean, optional): Include content preview for text files (default: false)

**Returns:**
- `exists` (boolean): Whether the path exists
- `type` (string): "file", "directory", or "unknown"
- `size` (number): Size in bytes
- `sizeHuman` (string): Human-readable size (e.g., "1.5 MB")
- `created`, `modified`, `accessed` (Date): Timestamps
- `isReadOnly` (boolean): Write permission check
- `pathInfo` (object): Path components (fullPath, directory, baseName, extension, fileNameWithoutExt)
- `mimeType` (string, files only): Inferred MIME type
- `isTextFile` (boolean, files only): Whether the file is likely text
- `directoryInfo` (object, directories only): Item counts and listing preview
- `contentPreview` (object, files only): First 10 lines preview (if requested)
- `warning` (string, optional): Large file warning

**Use Cases:**
- Check if a file exists before reading
- Determine file type (text vs binary)
- Get file size to decide how to read it
- Preview content structure

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

#### fs_grep

Search text across files. Supports both single file and multi-file search.

**Parameters:**
- `pattern` (string, required): Search pattern
- `path` (string, optional): File or directory path (default: current)
- `file_pattern` (string, optional): File pattern filter (default: "*")
- `use_regex` (boolean, optional): Use regex mode (default: `false`, use literal string match)
- `ignore_case` (boolean, optional): Case insensitive search (default: `true`)

**Search Modes:**
| Mode | Description | Example |
|------|-------------|---------|
| Literal (default) | Simple string match, no special characters | `pattern: "TODO"` matches "TODO" exactly |
| Regex | Full regex support, set `use_regex: true` | `pattern: "TODO\\d+"` matches "TODO1", "TODO123" |

**Note:** For single file search, pass the file path directly to `path` parameter.

**Examples:**
```javascript
// Simple string search (default, recommended for LLM)
{ "tool": "fs_grep", "params": { "pattern": "function", "path": "src/" } }

// Regex search
{ "tool": "fs_grep", "params": { "pattern": "function\\s+\\w+", "path": "src/", "use_regex": true } }

// Case sensitive search
{ "tool": "fs_grep", "params": { "pattern": "TODO", "path": "src/", "ignore_case": false } }
```

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

#### edit_lines

Edit lines in a file with insert or delete operations.

**Parameters:**
- `path` (string, required): File path
- `operation` (string, optional): Operation type - `"insert"` (default) or `"delete"`
- `line` (number, required): Line number (1-based)
- `end_line` (number, optional): End line number for delete operation (defaults to `line`)
- `content` (string, required for insert): Content to insert

**Operations:**
| Operation | Description | Required Params |
|-----------|-------------|-----------------|
| `insert` | Insert content before the specified line | `path`, `line`, `content` |
| `delete` | Delete lines from `line` to `end_line` | `path`, `line`, `end_line` (optional) |

**Examples:**
```javascript
// Insert a line at line 5
{ "tool": "edit_lines", "params": { "path": "file.txt", "line": 5, "content": "new line" } }

// Delete line 10
{ "tool": "edit_lines", "params": { "path": "file.txt", "operation": "delete", "line": 10 } }

// Delete lines 10-15
{ "tool": "edit_lines", "params": { "path": "file.txt", "operation": "delete", "line": 10, "end_line": 15 } }
```

**Tip:** For content replacement (e.g., "replace 'foo' with 'bar'"), use `replace_in_file` tool instead.

### File System Operations

#### fs_action

Unified file system operations: copy, move, delete, and create directory.

**Parameters:**
- `operation` (string, optional): Operation type - `"copy"` (default), `"move"`, `"delete"`, or `"create_dir"`
- `source` (string, required for copy/move): Source path
- `destination` (string, required for copy/move): Destination path
- `path` (string, required for delete/create_dir): Path to delete or directory to create

**Operations:**
| Operation | Description | Required Params |
|-----------|-------------|-----------------|
| `copy` | Copy file to destination | `source`, `destination` |
| `move` | Move file to destination | `source`, `destination` |
| `delete` | Delete file or directory (recursive) | `path` |
| `create_dir` | Create directory (recursive) | `path` |

**Examples:**
```javascript
// Copy a file
{ "tool": "fs_action", "params": { "source": "file.txt", "destination": "backup.txt" } }

// Move a file
{ "tool": "fs_action", "params": { "operation": "move", "source": "old.txt", "destination": "new.txt" } }

// Delete a file or directory
{ "tool": "fs_action", "params": { "operation": "delete", "path": "unwanted.txt" } }

// Create a directory
{ "tool": "fs_action", "params": { "operation": "create_dir", "path": "new_folder" } }
```

## Security

### Path Restrictions

| User Type | Relative Path | Absolute Path |
|-----------|---------------|---------------|
| Normal User | ✅ Allowed (relative to working directory) | ❌ Denied |
| Admin | ✅ Allowed (relative to working directory) | ✅ Allowed (within permitted directories) |

### Allowed Directories

| User Type | Allowed Directories |
|-----------|---------------------|
| Normal User | Current working directory only (task or temp) |
| Admin | Current working directory + `data/skills` directory |

### Examples

```javascript
// Normal user - relative path (allowed)
list_files({ path: "." })  // Lists current working directory

// Normal user - absolute path (denied)
list_files({ path: "d:/projects/.../data/skills" })  // Error!

// Admin - relative path (allowed)
list_files({ path: "." })  // Lists current working directory

// Admin - absolute path to skills (allowed)
list_files({ path: "d:/projects/.../data/skills/file-operations" })  // OK!
```

## Examples

```javascript
// Get file/directory information (recommended first step)
{ "tool": "fs_info", "params": { "path": "data/example.txt" } }

// Get file info with content preview
{ "tool": "fs_info", "params": { "path": "data/example.txt", "include_content_preview": true } }

// Check if a directory exists and see its contents
{ "tool": "fs_info", "params": { "path": "data/src" } }

// Read a file (lines mode)
{ "tool": "read_file", "params": { "path": "data/example.txt" } }

// Read file in bytes mode
{ "tool": "read_file", "params": { "path": "data/binary.bin", "mode": "bytes", "bytes": 1000 } }

// Search in files
{ "tool": "fs_grep", "params": { "pattern": "TODO", "path": "data/src" } }

// Write a file
{ "tool": "write_file", "params": { "path": "data/output.txt", "content": "Hello!" } }

// Append to a file
{ "tool": "write_file", "params": { "path": "data/log.txt", "content": "New entry\n", "mode": "append" } }

// Copy a file
{ "tool": "fs_action", "params": { "source": "data/file.txt", "destination": "data/backup.txt" } }

// Move a file
{ "tool": "fs_action", "params": { "operation": "move", "source": "data/old.txt", "destination": "data/new.txt" } }

// Delete a file or directory
{ "tool": "fs_action", "params": { "operation": "delete", "path": "data/unwanted.txt" } }

// Create a directory
{ "tool": "fs_action", "params": { "operation": "create_dir", "path": "data/new_folder" } }
```

## Best Practices for LLM

1. **Always call `fs_info` first** when working with an unknown path:
   - Check if the file exists
   - Determine if it's a file or directory
   - See the file size before reading
   - Check if it's a text file

2. **Use `include_content_preview`** to quickly understand file structure without reading the entire file

3. **Handle large files carefully**:
   - Check `size` or `sizeHuman` before reading
   - Use `from` and `lines` parameters to read in chunks
   - Watch for `warning` field in `fs_info` response

4. **Example workflow**:
   ```
   1. fs_info(path) → Check existence, type, size
   2. If text file and small: read_file(path)
   3. If text file and large: read_file(path, from=1, lines=100)
   4. If directory: list_files(path) for detailed listing
   ```
