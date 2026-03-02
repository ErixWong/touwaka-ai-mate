#!/usr/bin/env python3
"""
Wiki.js GraphQL API Client

Usage:
    from wikijs_client import WikiJSClient
    client = WikiJSClient()
    pages = client.list_pages()
"""

import os
import json
import base64
import requests
from typing import Optional, List, Dict, Any, BinaryIO, Union


class WikiJSClient:
    """Client for Wiki.js GraphQL API."""
    
    def __init__(self, url: Optional[str] = None, token: Optional[str] = None):
        """
        Initialize Wiki.js client.
        
        Args:
            url: Wiki.js instance URL (defaults to WIKIJS_URL env var)
            token: API token (defaults to WIKIJS_TOKEN env var)
        """
        self.url = url or os.environ.get("WIKIJS_URL", "")
        self.token = token or os.environ.get("WIKIJS_TOKEN", "")
        
        if not self.url:
            raise ValueError("Wiki.js URL not provided. Set WIKIJS_URL or pass url parameter.")
        if not self.token:
            raise ValueError("API token not provided. Set WIKIJS_TOKEN or pass token parameter.")
        
        self.graphql_url = f"{self.url.rstrip('/')}/graphql"
        self.upload_url = f"{self.url.rstrip('/')}/u"
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}"
        }
    
    def _query(self, query: str, variables: Optional[Dict] = None) -> Dict[str, Any]:
        """Execute GraphQL query/mutation."""
        payload = {"query": query}
        if variables:
            payload["variables"] = variables
        
        response = requests.post(
            self.graphql_url,
            json=payload,
            headers=self.headers,
            timeout=60
        )
        response.raise_for_status()
        return response.json()
    
    # ==================== Page Operations ====================
    
    def list_pages(
        self,
        locale: str = "en",
        order_by: str = "TITLE",
        order_direction: str = "ASC"
    ) -> List[Dict[str, Any]]:
        """List all pages."""
        query = '''
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
        '''
        result = self._query(query, {
            "locale": locale,
            "orderBy": order_by,
            "orderDirection": order_direction
        })
        return result.get("data", {}).get("pages", {}).get("list", [])
    
    def get_page_by_id(self, page_id: int) -> Optional[Dict[str, Any]]:
        """Get page by ID."""
        query = '''
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
        '''
        result = self._query(query, {"id": page_id})
        return result.get("data", {}).get("pages", {}).get("single")
    
    def get_page_by_path(
        self,
        path: str,
        locale: str = "en"
    ) -> Optional[Dict[str, Any]]:
        """Get page by path."""
        query = '''
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
        '''
        result = self._query(query, {"path": path, "locale": locale})
        return result.get("data", {}).get("pages", {}).get("singleByPath")
    
    def create_page(
        self,
        path: str,
        title: str,
        content: str,
        locale: str = "en",
        description: str = "",
        tags: Optional[List[str]] = None,
        is_published: bool = True,
        is_private: bool = False,
        editor: str = "markdown"
    ) -> Dict[str, Any]:
        """Create a new page."""
        tags = tags or []
        mutation = '''
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
        '''
        return self._query(mutation, {
            "content": content,
            "description": description,
            "editor": editor,
            "isPublished": is_published,
            "isPrivate": is_private,
            "locale": locale,
            "path": path,
            "tags": tags,
            "title": title
        })
    
    def update_page(
        self,
        page_id: int,
        content: Optional[str] = None,
        title: Optional[str] = None,
        description: Optional[str] = None,
        tags: Optional[List[str]] = None,
        is_published: Optional[bool] = None,
        is_private: Optional[bool] = None
    ) -> Dict[str, Any]:
        """Update an existing page."""
        mutation = '''
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
        '''
        variables = {"id": page_id}
        if content is not None:
            variables["content"] = content
        if title is not None:
            variables["title"] = title
        if description is not None:
            variables["description"] = description
        if tags is not None:
            variables["tags"] = tags
        if is_published is not None:
            variables["isPublished"] = is_published
        if is_private is not None:
            variables["isPrivate"] = is_private
        
        return self._query(mutation, variables)
    
    def delete_page(self, page_id: int) -> Dict[str, Any]:
        """Delete a page."""
        mutation = '''
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
        '''
        return self._query(mutation, {"id": page_id})
    
    # ==================== Tree Operations ====================
    
    def get_page_tree(
        self,
        mode: str = "FOLDERS",
        locale: str = "en",
        parent_path: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get page tree structure.
        
        Args:
            mode: "ALL", "FOLDERS", or "PAGES"
            locale: Locale code
            parent_path: Optional parent path to filter
        """
        query = '''
        query($mode: PageTreeMode!, $locale: String!, $parent: String) {
            pages {
                tree(mode: $mode, locale: $locale, parent: $parent) {
                    id
                    path
                    title
                }
            }
        }
        '''
        result = self._query(query, {
            "mode": mode,
            "locale": locale,
            "parent": parent_path
        })
        return result.get("data", {}).get("pages", {}).get("tree", [])
    
    # ==================== Search Operations ====================
    
    def search_pages(
        self,
        query_str: str,
        locale: str = "en"
    ) -> List[Dict[str, Any]]:
        """Search pages by keyword."""
        query = '''
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
        '''
        result = self._query(query, {"query": query_str, "locale": locale})
        return result.get("data", {}).get("pages", {}).get("search", {}).get("results", [])
    
    # ==================== Asset Operations ====================
    
    def list_asset_folders(self, parent_folder_id: int = 0) -> List[Dict[str, Any]]:
        """List asset folders."""
        query = '''
        query($parentFolderId: Int!) {
            assets {
                folders(parentFolderId: $parentFolderId) {
                    id
                    name
                    slug
                }
            }
        }
        '''
        result = self._query(query, {"parentFolderId": parent_folder_id})
        return result.get("data", {}).get("assets", {}).get("folders", [])
    
    def create_asset_folder(
        self,
        name: str,
        slug: str,
        parent_folder_id: int = 0
    ) -> Dict[str, Any]:
        """Create an asset folder."""
        mutation = '''
        mutation($name: String!, $slug: String!, $parentFolderId: Int!) {
            assets {
                createFolder(
                    name: $name
                    slug: $slug
                    parentFolderId: $parentFolderId
                ) {
                    responseResult {
                        succeeded
                        message
                    }
                }
            }
        }
        '''
        return self._query(mutation, {
            "name": name,
            "slug": slug,
            "parentFolderId": parent_folder_id
        })
    
    def list_assets(
        self,
        folder_id: int,
        kind: str = "ALL"
    ) -> List[Dict[str, Any]]:
        """List assets in a folder.
        
        Args:
            folder_id: Folder ID
            kind: "ALL", "IMAGE", "BINARY", "PDF", "CODE", "MARKUP", "VIDEO", "AUDIO"
        """
        query = '''
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
        '''
        result = self._query(query, {"folderId": folder_id, "kind": kind})
        return result.get("data", {}).get("assets", {}).get("list", [])
    
    def upload_file(
        self,
        file: Union[BinaryIO, str, bytes],
        filename: str,
        folder_id: int = 0
    ) -> Dict[str, Any]:
        """
        Upload a file to Wiki.js assets.
        
        Wiki.js upload requires TWO fields named 'mediaUpload':
        1. Text field: mediaUpload = '{"folderId": 1}' (folder metadata as JSON)
        2. File field: mediaUpload = <binary data> (actual file)
        
        Args:
            file: File to upload (file object, path string, or bytes)
            filename: Name of the file
            folder_id: Target folder ID (0 for root)
        
        Returns:
            Response dict with 'succeeded' and 'message' or 'ok'
        """
        # Handle different file input types
        if isinstance(file, str):
            # File path
            with open(file, 'rb') as f:
                file_data = f.read()
        elif hasattr(file, 'read'):
            # File-like object
            file.seek(0)
            file_data = file.read()
        else:
            # Bytes
            file_data = file
        
        # Build multipart body manually to handle duplicate field names
        boundary = '----WikiJSUploadBoundary' + os.urandom(8).hex()
        
        body_parts = []
        
        # Field 1: mediaUpload (folder metadata as JSON text)
        body_parts.append(
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="mediaUpload"\r\n\r\n'
            f'{{"folderId":{folder_id}}}\r\n'
        )
        
        # Field 2: mediaUpload (the actual file)
        mime_type = self._get_mime_type(filename)
        body_parts.append(
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="mediaUpload"; filename="{filename}"\r\n'
            f'Content-Type: {mime_type}\r\n\r\n'
        )
        
        # Combine text parts and binary file data
        body = ''.join(body_parts).encode('utf-8')
        body += file_data
        body += f'\r\n--{boundary}--\r\n'.encode('utf-8')
        
        # Send request
        headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': f'multipart/form-data; boundary={boundary}',
            'Content-Length': str(len(body))
        }
        
        response = requests.post(
            self.upload_url,
            data=body,
            headers=headers,
            timeout=120
        )
        
        if response.text == 'ok':
            return {"succeeded": True, "message": "File uploaded successfully"}
        else:
            try:
                return response.json()
            except:
                return {"succeeded": False, "message": response.text}
    
    def delete_asset(self, asset_id: int) -> Dict[str, Any]:
        """Delete an asset."""
        mutation = '''
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
        '''
        return self._query(mutation, {"id": asset_id})
    
    def _get_mime_type(self, filename: str) -> str:
        """Get MIME type from filename extension."""
        ext = os.path.splitext(filename)[1].lower()
        mime_types = {
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
            '.md': 'text/markdown',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.ppt': 'application/vnd.ms-powerpoint',
            '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        }
        return mime_types.get(ext, 'application/octet-stream')
    
    def get_asset_url(self, folder_path: str, filename: str) -> str:
        """
        Get the URL for an asset.
        
        Args:
            folder_path: Path to the folder (e.g., "/ppt-images" or "")
            filename: Asset filename
        
        Returns:
            Full URL to the asset
        """
        base = self.url.rstrip('/')
        if folder_path:
            folder_path = folder_path.strip('/')
            return f"{base}/{folder_path}/{filename}"
        else:
            return f"{base}/{filename}"


if __name__ == "__main__":
    # Simple test
    client = WikiJSClient()
    print("Testing Wiki.js connection...")
    pages = client.list_pages()
    print(f"Found {len(pages)} pages")
    for p in pages[:5]:
        print(f"  - {p['path']}: {p['title']}")
