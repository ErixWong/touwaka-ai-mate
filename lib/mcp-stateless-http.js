/**
 * StatelessHTTPTransport - 用于无状态的 HTTP MCP Server
 * 
 * 某些 MCP Server（如 markitdown）是无状态的（无 session-id），不需要 GET SSE stream。
 * SDK 的 StreamableHTTPClientTransport 会在 start() 后尝试 GET SSE，导致超时。
 * 
 * 这个 Transport 跳过 GET SSE 步骤，只通过 POST 发送请求。
 */

function transportLog(...args) {
  process.stderr.write(`[StatelessHTTPTransport] ${new Date().toISOString()} ${args.join(' ')}\n`);
}

export class StatelessHTTPTransport {
  constructor(url, options = {}) {
    this._url = url;
    this._requestInit = options.requestInit || {};
    this._timeout = options.timeout || 600000;
    this._started = false;
    
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    
    transportLog(`Created for URL: ${url}, timeout: ${this._timeout}ms`);
  }
  
  async start() {
    if (this._started) {
      throw new Error('Transport already started');
    }
    this._started = true;
    transportLog(`Started`);
  }
  
  async close() {
    this._started = false;
    transportLog(`Closed`);
    if (this.onclose) this.onclose();
  }
  
  async send(message) {
    if (!this._started) {
      throw new Error('Transport not started');
    }
    
    const messages = Array.isArray(message) ? message : [message];
    transportLog(`Sending ${messages.length} messages`);
    
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
    const msgPreview = JSON.stringify(message).substring(0, 200);
    
    transportLog(`Sending to ${this._url}`);
    transportLog(`Message preview: ${msgPreview}`);
    transportLog(`Headers: ${JSON.stringify(Object.keys(headers))}`);
    transportLog(`Body size: ${body.length} bytes, timeout: ${this._timeout}ms`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      transportLog(`Request aborted due to timeout (${this._timeout}ms)`);
      controller.abort();
    }, this._timeout);
    
    try {
      const response = await fetch(this._url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      transportLog(`Response status: ${response.status}`);
      transportLog(`Response content-type: ${response.headers.get('content-type')}`);
      
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        transportLog(`Response error body: ${text.substring(0, 200)}`);
        throw new Error(`HTTP ${response.status}: ${text.substring(0, 100)}`);
      }
      
      const contentType = response.headers.get('content-type') || '';
      
      if (response.status === 202) {
        transportLog(`Response 202 Accepted, no body`);
        return;
      }
      
      if (contentType.includes('application/json')) {
        const text = await response.text();
        transportLog(`Response JSON length: ${text.length}`);
        if (!text || text.trim() === '') {
          return;
        }
        const data = JSON.parse(text);
        if (this.onmessage) {
          this.onmessage(data);
        }
      } else if (contentType.includes('text/event-stream')) {
        transportLog(`Handling SSE stream`);
        await this._handleSSE(response);
      }
      
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        transportLog(`ERROR: Request timeout (${this._timeout}ms)`);
        error = new Error(`Request timeout after ${this._timeout}ms`);
      }
      transportLog(`ERROR: ${error.message}`);
      transportLog(`ERROR stack: ${error.stack}`);
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