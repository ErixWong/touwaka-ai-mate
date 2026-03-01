---
name: compression
description: ZIP file operations for creating and extracting archives.
argument-hint: "[zip|unzip] [path]"
user-invocable: true
allowed-tools:
  - Bash(zip *)
  - Bash(unzip *)
---

# Compression

Create and extract ZIP archives.

## Tools

### zip

Create a ZIP archive from files or directories.

**Parameters:**
- `source` (string, required): Source file or directory path
- `destination` (string, optional): Output ZIP file path (default: source.zip)
- `compression_level` (number, optional): 0-9 (default: 6)

**Examples:**
```javascript
// Zip a directory
{ "source": "data/project" }

// Zip with custom name
{ "source": "data/files", "destination": "data/backup.zip" }
```

### unzip

Extract a ZIP archive.

**Parameters:**
- `source` (string, required): ZIP file path
- `destination` (string, optional): Extract destination (default: current directory)

**Examples:**
```javascript
// Unzip to current directory
{ "source": "data/archive.zip" }

// Unzip to specific directory
{ "source": "data/archive.zip", "destination": "data/extracted" }
```

## Security

All operations are restricted to allowed directories.
Source paths outside the data directory require proper permissions.