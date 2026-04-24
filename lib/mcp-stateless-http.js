/**
 * StatelessHTTPTransport - 用于无状态的 HTTP MCP Server
 * 
 * 某些 MCP Server（如 markitdown）是无状态的（无 session-id），不需要 GET SSE stream。
 * SDK 的 StreamableHTTPClientTransport 会在 start() 后尝试 GET SSE，导致超时。
 * 
 * 这个 Transport 跳过 GET SSE 步骤，只通过 POST 发送请求。
 */

export class StatelessHTTPTransport {
  constructor(url, options = {}) {
    this._url = url;
    this._requestInit = options.requestInit || {};
    this._started = false;
    
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
  }
  
  async start() {
    if (this._started) {
      throw new Error('Transport already started');
    }
    this._started = true;
  }
  
  async close() {
    this._started = false;
    if (this.onclose) this.onclose();
  }
  
  async send(message) {
    if (!this._started) {
      throw new Error('Transport not started');
    }
    
    const messages = Array.isArray(message) ? message : [message];
    
    for (const msg of messages) {
      await this._sendSingle(msg);
    }
  }
  
  async _sendSingle(message) {
    const headers = {
      ...(this._requestInit.headers || {}),
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    
    const body = JSON.stringify(message);
    
    try {
      const response = await fetch(this._url, {
        method: 'POST',
        headers,
        body,
      });
      
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text.substring(0, 100)}`);
      }
      
      const contentType = response.headers.get('content-type') || '';
      
      // 202 Accepted - notification 无响应体
      if (response.status === 202) {
        return;
      }
      
      if (contentType.includes('application/json')) {
        const text = await response.text();
        if (!text || text.trim() === '') {
          return;
        }
        const data = JSON.parse(text);
        if (this.onmessage) {
          this.onmessage(data);
        }
      } else if (contentType.includes('text/event-stream')) {
        await this._handleSSE(response);
      }
      
    } catch (error) {
      if (this.onerror) {
        this.onerror(error);
      }
      throw error;
    }
  }
  
  async _handleSSE(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        
        for (const event of events) {
          const lines = event.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const data = line.substring(5).trim();
              if (data && this.onmessage) {
                try {
                  this.onmessage(JSON.parse(data));
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        }
      }
    } catch (error) {
      if (this.onerror) {
        this.onerror(error);
      }
    }
  }
}

export default StatelessHTTPTransport;