---
name: wikijs
description: Interact with Wiki.js instances via GraphQL API and REST upload endpoint. Supports page CRUD operations (list, get, create, update, delete), directory browsing, asset management (upload with proper multipart format, list, delete folders), and search. Use when working with Wiki.js wikis for documentation management, content migration, automated wiki operations, or file uploads. Requires WIKIJS_URL and WIKIJS_TOKEN environment variables.
---

# Wiki.js

Interact with Wiki.js instances programmatically via GraphQL API and REST upload endpoint.

## Quick Start

Required environment variables:
- `WIKIJS_URL` - Wiki.js instance URL (e.g., `https://wiki.example.com`)
- `WIKIJS_TOKEN` - API token from Admin > API Access

Basic usage:
```javascript
const WikiJSClient = require('./scripts/wikijs_client');

const client = new WikiJSClient();
const pages = await client.listPages();
```

## Core Operations

### Pages

**List all pages:**
```javascript
const pages = await client.listPages({ orderBy: 'TITLE' });
```

**Get page by path:**
```javascript
const page = await client.getPageByPath('folder/page-name', 'en');
```

**Get page by ID:**
```javascript
const page = await client.getPageById(123);
```

**Create page:**
```javascript
await client.createPage({
    path: 'docs/new-page',
    title: 'New Page',
    content: '# Hello World',
    locale: 'en',
    description: 'Page description',
    tags: ['tag1', 'tag2'],
    isPublished: true
});
```

**Update page:**
```javascript
await client.updatePage(123, {
    content: '# Updated content',
    title: 'New Title'
});
```

**Delete page:**
```javascript
await client.deletePage(123);
```

### Directory Tree

**Get page tree:**
```javascript
const tree = await client.getPageTree('FOLDERS', 'en');
```

Modes: `ALL`, `FOLDERS`, `PAGES`

### Search

**Search pages:**
```javascript
const results = await client.searchPages('keyword', 'en');
```

## File Upload (IMPORTANT)

Wiki.js file upload uses a **special multipart format** requiring **TWO fields named `mediaUpload`**:

### Upload Format

```
Field 1 (text):  mediaUpload = {"folderId": 1}    ← Folder metadata (JSON)
Field 2 (file):  mediaUpload = <binary data>      ← Actual file content
```

Both fields MUST have the same name `mediaUpload`.

### Upload Methods

**Method 1: Using the client (Recommended)**
```javascript
// Upload from file path
const result = await client.uploadFile(
    '/path/to/image.png',
    'image.png',
    1  // folderId
);

// Upload from Buffer
const fs = require('fs');
const fileBuffer = fs.readFileSync('image.png');
const result = await client.uploadFile(fileBuffer, 'image.png', 1);

// Check result
if (result.succeeded) {
    console.log('Upload successful!');
}
```

**Method 2: Manual multipart construction**
```javascript
const https = require('https');
const fs = require('fs');

const boundary = '----WikiJSUploadBoundary';
const folderId = 1;
const filename = 'image.png';
const fileData = fs.readFileSync(filename);

// Build body with TWO mediaUpload fields
let body = Buffer.alloc(0);

// Field 1: mediaUpload (folder metadata as JSON text)
body = Buffer.concat([
    body,
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="mediaUpload"\r\n\r\n'),
    Buffer.from(`{"folderId":${folderId}}\r\n`)
]);

// Field 2: mediaUpload (the actual file)
body = Buffer.concat([
    body,
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="mediaUpload"; filename="${filename}"\r\n`),
    Buffer.from('Content-Type: image/png\r\n\r\n'),
    fileData,
    Buffer.from('\r\n')
]);

// End boundary
body = Buffer.concat([
    body,
    Buffer.from(`--${boundary}--\r\n`)
]);

// Send request
const options = {
    hostname: 'wiki.example.com',
    port: 443,
    path: '/u',
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        if (data === 'ok') {
            console.log('Upload successful!');
        }
    });
});

req.write(body);
req.end();
```

### Common Upload Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Missing upload folder metadata" | Missing JSON metadata field | Add text field `mediaUpload={"folderId":1}` |
| "Missing upload payload" | Missing file field | Add file field named `mediaUpload` |
| "You are not authorized" | No `write:assets` permission | Check API token scopes in Admin > API Access |
| 403 Forbidden | Permission denied | Ensure token has `write:assets` or `manage:system` scope |

## Asset Management

### Folders

**List asset folders:**
```javascript
const folders = await client.listAssetFolders(0);
```

**Create asset folder:**
```javascript
await client.createAssetFolder('Images', 'images', 0);
```

### Assets

**List assets in folder:**
```javascript
const assets = await client.listAssets(1, 'IMAGE');
```

Kinds: `ALL`, `IMAGE`, `BINARY`, `PDF`, `CODE`, `MARKUP`, `VIDEO`, `AUDIO`

**Delete asset:**
```javascript
await client.deleteAsset(456);
```

**Get asset URL:**
```javascript
const url = client.getAssetUrl('ppt-images', 'slide_01.png');
// Returns: https://wiki.example.com/ppt-images/slide_01.png
```

## Working with Content

### Markdown with Asset References

After uploading images, reference them in pages:
```javascript
// Upload images first
const fs = require('fs');
const path = require('path');

const imageDir = 'tmp/ppt_extracted/slides_png_hd2';
const files = fs.readdirSync(imageDir).filter(f => f.endsWith('.png'));

for (const file of files) {
    await client.uploadFile(path.join(imageDir, file), file, 1);
}

// Create page with references
const content = `# Presentation

## Slide 1
![Slide 1](/ppt-images/slide_01.png)

## Slide 2
![Slide 2](/ppt-images/slide_02.png)
`;

await client.createPage({
    path: 'docs/presentation',
    title: 'My Presentation',
    content: content
});
```

### Embedded Images (Base64 Alternative)

For self-contained pages without external assets:
```javascript
const fs = require('fs');

const imageBuffer = fs.readFileSync('image.png');
const b64 = imageBuffer.toString('base64');
const dataUri = `data:image/png;base64,${b64}`;

const content = `![Image](${dataUri})`;
```

## Scripts

### `wikijs_client.js`
Main client class with all API methods including proper file upload handling.

## Related Skills

### PPT to Wiki.js Bridge

For converting PowerPoint presentations to Wiki.js pages, use the **ppt-to-wiki** skill:

```bash
node skills/ppt-to-wiki/scripts/ppt_to_wiki.js \
    --content tmp/ppt_extracted/content.md \
    --images tmp/ppt_extracted/slides_png_hd2 \
    --output-path "ppt/presentation-name" \
    --title "Presentation Title" \
    --upload-to-folder 1
```

See `skills/ppt-to-wiki/SKILL.md` for details.

## Error Handling

All methods return an object with `responseResult`:
```javascript
const result = await client.createPage({...});
if (result.data?.pages?.create?.responseResult?.succeeded) {
    const pageId = result.data.pages.create.page.id;
} else {
    const error = result.data?.pages?.create?.responseResult?.message;
}
```

Or using async/await with try/catch:
```javascript
try {
    const pages = await client.listPages();
} catch (err) {
    console.error('Error:', err.message);
}
```

## References

- **API Documentation**: See [references/api_docs.md](references/api_docs.md) for complete GraphQL schema reference
- **Common Patterns**: See [references/patterns.md](references/patterns.md) for usage examples
- **Upload Deep Dive**: See [references/upload_guide.md](references/upload_guide.md) for detailed upload documentation
