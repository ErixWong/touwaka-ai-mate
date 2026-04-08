const https = require('https');
const { URL } = require('url');

// API Endpoints
const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';
const ALGOLIA_API_BASE = 'https://hn.algolia.com/api/v1';

// AI Domain Keywords
const AI_KEYWORDS = [
  'AI', 'artificial intelligence', 'machine learning', 'deep learning',
  'neural network', 'LLM', 'large language model', 'GPT', 'Claude',
  'OpenAI', 'Anthropic', 'transformer', 'NLP', 'computer vision',
  'ChatGPT', 'Gemini', 'Llama', 'stable diffusion', 'midjourney'
];

// Story type to endpoint mapping
const STORY_ENDPOINTS = {
  top: 'topstories',
  new: 'newstories',
  best: 'beststories',
  ask: 'askstories',
  show: 'showstories',
  jobs: 'jobstories'
};

// Story type to title mapping
const STORY_TITLES = {
  top: '🔥 Top Stories',
  new: '🆕 New Stories',
  best: '⭐ Best Stories',
  ask: '❓ Ask HN',
  show: '👀 Show HN',
  jobs: '💼 Jobs',
  ai: '🤖 AI Domain Stories',
  search: '🔍 Search Results'
};

// Helper: Fetch JSON from URL
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'hackernews-node/1.0.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

// Get stories from HN API (top, new, best, ask, show, jobs)
async function getHNStories(type, limit = 10) {
  const endpoint = STORY_ENDPOINTS[type];
  if (!endpoint) {
    throw new Error(`Invalid story type: ${type}`);
  }

  const ids = await fetchJSON(`${HN_API_BASE}/${endpoint}.json`);
  const stories = await Promise.all(
    ids.slice(0, limit).map(id => fetchJSON(`${HN_API_BASE}/item/${id}.json`))
  );
  return stories.filter(s => s && s.title);
}

// Get AI domain stories with time filter
async function getAIStories(limit = 10, period = 'all') {
  const periodFilter = {
    day: 'created_at_i>=' + Math.floor((Date.now() - 86400000) / 1000),
    week: 'created_at_i>=' + Math.floor((Date.now() - 604800000) / 1000),
    month: 'created_at_i>=' + Math.floor((Date.now() - 2592000000) / 1000),
    all: ''
  };

  const query = AI_KEYWORDS.map(k => `"${k}"`).join(' OR ');
  let url = `${ALGOLIA_API_BASE}/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;

  if (periodFilter[period]) {
    url += `&numericFilters=${periodFilter[period]}`;
  }

  const data = await fetchJSON(url);
  return data.hits || [];
}

// Search stories
async function searchStories(query, limit = 10) {
  const url = `${ALGOLIA_API_BASE}/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
  const data = await fetchJSON(url);
  return data.hits || [];
}

// Format output
function formatOutput(stories, json = false, title = 'Stories') {
  if (json) {
    return JSON.stringify({ count: stories.length, stories }, null, 2);
  }

  const lines = [`\n${title}\n${'='.repeat(50)}`];
  stories.forEach((s, i) => {
    const url = s.url || `https://news.ycombinator.com/item?id=${s.objectID || s.id}`;
    lines.push(`\n${i + 1}. ${s.title}`);
    lines.push(`   ${url}`);
    lines.push(`   👍 ${s.points || s.score || 0} | 💬 ${s.num_comments || s.descendants || 0} | @${s.author || s.by || 'unknown'}`);
  });
  return lines.join('\n');
}

// Main execute function
async function execute(toolName, params) {
  // Only support 'stories' tool
  if (toolName !== 'stories') {
    throw new Error(`Unknown tool: ${toolName}. Only 'stories' is supported.`);
  }

  const {
    type = 'top',
    limit = 10,
    json = false,
    period = 'all',
    query
  } = params || {};

  // Validate type
  const validTypes = ['top', 'new', 'best', 'ask', 'show', 'jobs', 'ai', 'search'];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}`);
  }

  let stories;
  let title = STORY_TITLES[type] || 'Stories';

  switch (type) {
    case 'top':
    case 'new':
    case 'best':
    case 'ask':
    case 'show':
    case 'jobs':
      stories = await getHNStories(type, limit);
      break;

    case 'ai':
      stories = await getAIStories(limit, period);
      break;

    case 'search':
      if (!query) throw new Error('query parameter required for search type');
      stories = await searchStories(query, limit);
      title = `🔍 Search: "${query}"`;
      break;

    default:
      throw new Error(`Unsupported type: ${type}`);
  }

  return formatOutput(stories, json, title);
}

// ============================================
// 工具定义
// ============================================

function getTools() {
  return [
    {
      name: 'stories',
      description: '获取 Hacker News 故事列表，支持多种类型：top/new/best/ask/show/jobs/ai/search',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: '故事类型：top/new/best/ask/show/jobs/ai/search' },
          limit: { type: 'number', description: '返回数量（默认10）' },
          json: { type: 'boolean', description: '是否返回JSON格式' },
          period: { type: 'string', description: 'AI类型的时间过滤：day/week/month/all' },
          query: { type: 'string', description: '搜索关键词（search类型必需）' }
        },
        required: []
      }
    }
  ];
}

module.exports = { execute, getTools };
