#!/usr/bin/env node
/**
 * Wiki.js GraphQL API Client for Node.js
 * 
 * Usage:
 *   const WikiJSClient = require('./wikijs_client');
 *   const client = new WikiJSClient();
 *   const pages = await client.listPages();
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class WikiJSClient {
    /**
     * Initialize Wiki.js client
     * @param {Object} options - Configuration options
     * @param {string} options.url - Wiki.js instance URL (defaults to WIKIJS_URL env var)
     * @param {string} options.token - API token (defaults to WIKIJS_TOKEN env var)
     */
    constructor(options = {}) {
        this.url = options.url || process.env.WIKIJS_URL || '';
        this.token = options.token || process.env.WIKIJS_TOKEN || '';
        
        if (!this.url) {
            throw new Error('Wiki.js URL not provided. Set WIKIJS_URL or pass url option.');
        }
        if (!this.token) {
            throw new Error('API token not provided. Set WIKIJS_TOKEN or pass token option.');
        }
        
        this.graphqlUrl = `${this.url.replace(/\/$/, '')}/graphql`;
        this.uploadUrl = `${this.url.replace(/\/$/, '')}/u`;
    }

    /**
     * Execute GraphQL query/mutation
     * @private
     */
    _query(query, variables = null) {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({ query, variables });
            
            const url = new URL(this.graphqlUrl);
            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Length': Buffer.byteLength(payload)
                }
            };

            const req = https.request(options, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    const encoding = res.headers['content-encoding'];
                    
                    let data;
                    if (encoding === 'gzip') {
                        const zlib = require('zlib');
                        data = zlib.gunzipSync(buffer);
                    } else {
                        data = buffer;
                    }
                    
                    try {
                        resolve(JSON.parse(data.toString()));
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                });
            });

            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    }

    // ==================== Page Operations ====================

    /**
     * List all pages
     * @param {string} locale - Locale code (default: 'en')
     * @param {string} orderBy - Order field: 'ID', 'PATH', 'TITLE', 'CREATED_AT', 'UPDATED_AT'
     * @param {string} orderDirection - 'ASC' or 'DESC'
     * @returns {Promise<Array>} List of pages
     */
    async listPages(locale = 'en', orderBy = 'TITLE', orderDirection = 'ASC') {
        const query = `
            query($locale: String!, $orderBy: PageOrderBy!, $orderDirection: PageOrderByDirection!) {
                pages {
                    list(locale: $locale, orderBy: $orderBy, orderDirection: $orderDirection) {
                        id
                        path
                        title
                        description
                        isPublished
                        updatedAt
                    }
                }
            }
        `;
        const result = await this._query(query, { locale, orderBy, orderDirection });
        return result.data?.pages?.list || [];
    }

    /**
     * Get page by ID
     * @param {number} pageId - Page ID
     * @returns {Promise<Object|null>} Page object or null
     */
    async getPageById(pageId) {
        const query = `
            query($id: Int!) {
                pages {
                    single(id: $id) {
                        id
                        path
                        title
                        content
                        description
                        tags { tag }
                        isPublished
                        isPrivate
                        locale
                        createdAt
                        updatedAt
                    }
                }
            }
        `;
        const result = await this._query(query, { id: pageId });
        return result.data?.pages?.single || null;
    }

    /**
     * Get page by path
     * @param {string} path - Page path
     * @param {string} locale - Locale code (default: 'en')
     * @returns {Promise<Object|null>} Page object or null
     */
    async getPageByPath(path, locale = 'en') {
        const query = `
            query($path: String!, $locale: String!) {
                pages {
                    singleByPath(path: $path, locale: $locale) {
                        id
                        path
                        title
                        content
                        description
                        tags { tag }
                        isPublished
                        isPrivate
                        locale
                        createdAt
                        updatedAt
                    }
                }
            }
        `;
        const result = await this._query(query, { path, locale });
        return result.data?.pages?.singleByPath || null;
    }

    /**
     * Create a new page
     * @param {Object} params - Page parameters
     * @returns {Promise<Object>} Create result
     */
    async createPage(params) {
        const {
            path: pagePath,
            title,
            content,
            locale = 'en',
            description = '',
            tags = [],
            isPublished = true,
            isPrivate = false,
            editor = 'markdown'
        } = params;

        const mutation = `
            mutation(
                $content: String!
                $description: String!
                $editor: String!
                $isPublished: Boolean!
                $isPrivate: Boolean!
                $locale: String!
                $path: String!
                $tags: [String]!
                $title: String!
            ) {
                pages {
                    create(
                        content: $content
                        description: $description
                        editor: $editor
                        isPublished: $isPublished
                        isPrivate: $isPrivate
                        locale: $locale
                        path: $path
                        tags: $tags
                        title: $title
                    ) {
                        responseResult {
                            succeeded
                            message
                        }
                        page {
                            id
                            path
                            title
                        }
                    }
                }
            }
        `;
        return await this._query(mutation, {
            content, description, editor, isPublished, isPrivate, locale,
            path: pagePath, tags, title
        });
    }

    /**
     * Update an existing page
     * @param {number} pageId - Page ID
     * @param {Object} updates - Fields to update
     * @returns {Promise<Object>} Update result
     */
    async updatePage(pageId, updates) {
        const mutation = `
            mutation(
                $id: Int!
                $content: String
                $description: String
                $isPublished: Boolean
                $isPrivate: Boolean
                $tags: [String]
                $title: String
            ) {
                pages {
                    update(
                        id: $id
                        content: $content
                        description: $description
                        isPublished: $isPublished
                        isPrivate: $isPrivate
                        tags: $tags
                        title: $title
                    ) {
                        responseResult {
                            succeeded
                            message
                        }
                        page {
                            id
                            path
                            title
                        }
                    }
                }
            }
        `;
        const variables = { id: pageId, ...updates };
        return await this._query(mutation, variables);
    }

    /**
     * Delete a page
     * @param {number} pageId - Page ID
     * @returns {Promise<Object>} Delete result
     */
    async deletePage(pageId) {
        const mutation = `
            mutation($id: Int!) {
                pages {
                    delete(id: $id) {
                        responseResult {
                            succeeded
                            message
                        }
                    }
                }
            }
        `;
        return await this._query(mutation, { id: pageId });
    }

    // ==================== Tree Operations ====================

    /**
     * Get page tree structure
     * @param {string} mode - 'ALL', 'FOLDERS', or 'PAGES'
     * @param {string} locale - Locale code
     * @param {string|null} parent - Parent path filter
     * @returns {Promise<Array>} Tree items
     */
    async getPageTree(mode = 'FOLDERS', locale = 'en', parent = null) {
        const query = `
            query($mode: PageTreeMode!, $locale: String!, $parent: String) {
                pages {
                    tree(mode: $mode, locale: $locale, parent: $parent) {
                        id
                        path
                        title
                    }
                }
            }
        `;
        const result = await this._query(query, { mode, locale, parent });
        return result.data?.pages?.tree || [];
    }

    // ==================== Search Operations ====================

    /**
     * Search pages by keyword
     * @param {string} query - Search query
     * @param {string} locale - Locale code
     * @returns {Promise<Array>} Search results
     */
    async searchPages(queryStr, locale = 'en') {
        const query = `
            query($query: String!, $locale: String!) {
                pages {
                    search(query: $query, locale: $locale) {
                        results {
                            id
                            path
                            title
                            description
                        }
                    }
                }
            }
        `;
        const result = await this._query(query, { query: queryStr, locale });
        return result.data?.pages?.search?.results || [];
    }

    // ==================== Asset Operations ====================

    /**
     * List asset folders
     * @param {number} parentFolderId - Parent folder ID (0 for root)
     * @returns {Promise<Array>} List of folders
     */
    async listAssetFolders(parentFolderId = 0) {
        const query = `
            query($parentFolderId: Int!) {
                assets {
                    folders(parentFolderId: $parentFolderId) {
                        id
                        name
                        slug
                    }
                }
            }
        `;
        const result = await this._query(query, { parentFolderId });
        return result.data?.assets?.folders || [];
    }

    /**
     * Create an asset folder
     * @param {string} name - Folder name
     * @param {string} slug - Folder slug
     * @param {number} parentFolderId - Parent folder ID
     * @returns {Promise<Object>} Create result
     */
    async createAssetFolder(name, slug, parentFolderId = 0) {
        const mutation = `
            mutation($name: String!, $slug: String!, $parentFolderId: Int!) {
                assets {
                    createFolder(name: $name, slug: $slug, parentFolderId: $parentFolderId) {
                        responseResult {
                            succeeded
                            message
                        }
                    }
                }
            }
        `;
        return await this._query(mutation, { name, slug, parentFolderId });
    }

    /**
     * List assets in a folder
     * @param {number} folderId - Folder ID
     * @param {string} kind - Asset kind: 'ALL', 'IMAGE', 'BINARY', 'PDF', etc.
     * @returns {Promise<Array>} List of assets
     */
    async listAssets(folderId, kind = 'ALL') {
        const query = `
            query($folderId: Int!, $kind: AssetKind!) {
                assets {
                    list(folderId: $folderId, kind: $kind) {
                        id
                        filename
                        ext
                        kind
                        mime
                        fileSize
                        createdAt
                        updatedAt
                    }
                }
            }
        `;
        const result = await this._query(query, { folderId, kind });
        return result.data?.assets?.list || [];
    }

    /**
     * Upload a file to Wiki.js
     * 
     * IMPORTANT: Wiki.js requires TWO fields named 'mediaUpload':
     * 1. Text field: mediaUpload = '{"folderId": 1}' (folder metadata as JSON)
     * 2. File field: mediaUpload = <binary data> (actual file)
     * 
     * @param {string|Buffer} file - File path or Buffer
     * @param {string} filename - Filename
     * @param {number} folderId - Target folder ID (0 for root)
     * @returns {Promise<Object>} Upload result
     */
    async uploadFile(file, filename, folderId = 0) {
        // Handle file input (path string or Buffer)
        let fileData;
        if (typeof file === 'string') {
            fileData = fs.readFileSync(file);
        } else if (Buffer.isBuffer(file)) {
            fileData = file;
        } else {
            throw new Error('File must be a path string or Buffer');
        }

        // Build multipart body with TWO mediaUpload fields
        const boundary = '----WikiJSUploadBoundary' + Math.random().toString(36).substring(2);
        
        let body = Buffer.alloc(0);
        
        // Field 1: mediaUpload (folder metadata as JSON text)
        body = Buffer.concat([
            body,
            Buffer.from(`--${boundary}\r\n`),
            Buffer.from('Content-Disposition: form-data; name="mediaUpload"\r\n\r\n'),
            Buffer.from(`{"folderId":${folderId}}\r\n`)
        ]);
        
        // Field 2: mediaUpload (the actual file)
        const mimeType = this._getMimeType(filename);
        body = Buffer.concat([
            body,
            Buffer.from(`--${boundary}\r\n`),
            Buffer.from(`Content-Disposition: form-data; name="mediaUpload"; filename="${filename}"\r\n`),
            Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`),
            fileData,
            Buffer.from('\r\n')
        ]);
        
        // End boundary
        body = Buffer.concat([
            body,
            Buffer.from(`--${boundary}--\r\n`)
        ]);

        // Send request
        return new Promise((resolve, reject) => {
            const url = new URL(this.uploadUrl);
            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': body.length
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (data === 'ok') {
                        resolve({ succeeded: true, message: 'File uploaded successfully' });
                    } else {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            resolve({ succeeded: false, message: data });
                        }
                    }
                });
            });

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Delete an asset
     * @param {number} assetId - Asset ID
     * @returns {Promise<Object>} Delete result
     */
    async deleteAsset(assetId) {
        const mutation = `
            mutation($id: Int!) {
                assets {
                    deleteAsset(id: $id) {
                        responseResult {
                            succeeded
                            message
                        }
                    }
                }
            }
        `;
        return await this._query(mutation, { id: assetId });
    }

    /**
     * Get the URL for an asset
     * @param {string} folderPath - Path to folder (e.g., "/ppt-images" or "")
     * @param {string} filename - Asset filename
     * @returns {string} Full URL to asset
     */
    getAssetUrl(folderPath, filename) {
        const base = this.url.replace(/\/$/, '');
        if (folderPath) {
            folderPath = folderPath.replace(/^\/|\/$/g, '');
            return `${base}/${folderPath}/${filename}`;
        }
        return `${base}/${filename}`;
    }

    /**
     * Get MIME type from filename
     * @private
     */
    _getMimeType(filename) {
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mp3': 'audio/mpeg',
            '.zip': 'application/zip',
            '.json': 'application/json',
            '.txt': 'text/plain',
            '.md': 'text/markdown'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }
}

module.exports = WikiJSClient;

// CLI test
if (require.main === module) {
    (async () => {
        try {
            const client = new WikiJSClient();
            console.log('Testing Wiki.js connection...');
            const pages = await client.listPages();
            console.log(`Found ${pages.length} pages`);
            pages.slice(0, 5).forEach(p => {
                console.log(`  - ${p.path}: ${p.title}`);
            });
        } catch (err) {
            console.error('Error:', err.message);
        }
    })();
}
