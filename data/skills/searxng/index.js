/**
 * SearXNG Skill - Node.js Implementation
 * 
 * Privacy-respecting metasearch using your local SearXNG instance.
 * Configure via SEARXNG_URL environment variable.
 * 
 * @module searxng-skill
 */

const https = require('https');
const http = require('http');
const url = require('url');
const querystring = require('querystring');

// SearXNG instance URL from environment or default
const SEARXNG_URL = process.env.SKILL_SEARXNG_URL || process.env.SEARXNG_URL || 'http://localhost:8080';

/**
 * Perform HTTP GET request
 * @param {string} requestUrl - Full URL to request
 * @param {object} options - Request options
 * @returns {Promise<object>} Response data
 */
function httpRequest(requestUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new url.URL(requestUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      timeout: options.timeout || 30000,
      // Disable SSL verification for local self-signed certs
      rejectUnauthorized: false,
    };

    const req = httpModule.request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON response: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Request failed: ${e.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Search using SearXNG instance
 * @param {object} params - Search parameters
 * @param {string} params.query - Search query string (required)
 * @param {number} [params.n=10] - Number of results to return (max: 50)
 * @param {string} [params.category='general'] - Search category
 * @param {string} [params.language='auto'] - Language code
 * @param {string} [params.time_range] - Time range filter (day, week, month, year)
 * @returns {Promise<object>} Search results
 */
async function searchSearxng(params) {
  const {
    query,
    n = 10,
    category = 'general',
    language = 'auto',
    time_range = null,
  } = params;

  if (!query) {
    throw new Error('Query parameter is required');
  }

  // Build query parameters
  const queryParams = {
    q: query,
    format: 'json',
    categories: category,
  };

  if (language !== 'auto') {
    queryParams.language = language;
  }

  if (time_range) {
    queryParams.time_range = time_range;
  }

  const requestUrl = `${SEARXNG_URL}/search?${querystring.stringify(queryParams)}`;

  try {
    const data = await httpRequest(requestUrl, { timeout: 30000 });

    // Limit results
    if (data.results && Array.isArray(data.results)) {
      data.results = data.results.slice(0, Math.min(n, 50));
    }

    return data;
  } catch (error) {
    return {
      error: error.message,
      results: [],
    };
  }
}

/**
 * Format results as readable table string
 * @param {object} data - Search results data
 * @param {string} query - Original search query
 * @returns {string} Formatted table output
 */
function formatResultsTable(data, query) {
  const results = data.results || [];

  if (results.length === 0) {
    return `No results found for: ${query}`;
  }

  let output = `\n=== SearXNG Search: ${query} ===\n\n`;

  // Table header
  output += '#    | Title                              | URL                                        | Engines\n';
  output += '-----|------------------------------------|--------------------------------------------|------------------\n';

  // Table rows
  results.forEach((result, i) => {
    const num = String(i + 1).padEnd(4);
    const title = (result.title || 'No title').substring(0, 34).padEnd(34);
    const urlStr = (result.url || '').substring(0, 42).padEnd(42);
    const engines = (result.engines || []).join(', ').substring(0, 16).padEnd(16);
    
    output += `${num} | ${title} | ${urlStr} | ${engines}\n`;
  });

  // Additional info
  if (data.number_of_results) {
    output += `\nTotal results available: ${data.number_of_results}\n`;
  }

  // Top results with snippets
  output += '\n=== Top Results ===\n';
  results.slice(0, 3).forEach((result, i) => {
    output += `\n${i + 1}. ${result.title || 'No title'}\n`;
    output += `   ${result.url || ''}\n`;
    if (result.content) {
      output += `   ${result.content.substring(0, 200)}...\n`;
    }
  });

  return output;
}

/**
 * Skill execute function - called by skill-runner
 * 
 * @param {string} toolName - Name of the tool to execute
 * @param {object} params - Tool parameters
 * @param {string} params.query - Search query (required)
 * @param {number} [params.n=10] - Number of results (default: 10, max: 50)
 * @param {string} [params.category='general'] - Search category
 * @param {string} [params.language='auto'] - Language code
 * @param {string} [params.time_range] - Time filter: day, week, month, year
 * @param {string} [params.format='json'] - Output format: json or table
 * @param {object} context - Execution context (userId, expertId, etc.)
 * @returns {Promise<object>} Execution result
 */
async function execute(toolName, params, context = {}) {
  switch (toolName) {
    case 'web_search': {
      const searchParams = {
        query: params.query,
        n: params.n || params.limit || 10,
        category: params.category || 'general',
        language: params.language || 'auto',
        time_range: params.time_range || params.timeRange || null,
      };

      const data = await searchSearxng(searchParams);

      // If format is 'table', return formatted string; otherwise return raw data
      if (params.format === 'table') {
        return {
          success: !data.error,
          format: 'table',
          output: formatResultsTable(data, searchParams.query),
          data: data
        };
      }

      return {
        success: !data.error,
        data: data
      };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// Export for skill-runner
module.exports = {
  execute,
  searchSearxng,
  formatResultsTable,
};
