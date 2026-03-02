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

// Get top stories
async function getTopStories(limit = 10) {
  const ids = await fetchJSON(`${HN_API_BASE}/topstories.json`);
  const stories = await Promise.all(
    ids.slice(0, limit).map(id => fetchJSON(`${HN_API_BASE}/item/${id}.json`))
  );
  return stories.filter(s => s && s.title);
}

// Get new stories
async function getNewStories(limit = 10) {
  const ids = await fetchJSON(`${HN_API_BASE}/newstories.json`);
  const stories = await Promise.all(
    ids.slice(0, limit).map(id => fetchJSON(`${HN_API_BASE}/item/${id}.json`))
  );
  return stories.filter(s => s && s.title);
}

// Get best stories
async function getBestStories(limit = 10) {
  const ids = await fetchJSON(`${HN_API_BASE}/beststories.json`);
  const stories = await Promise.all(
    ids.slice(0, limit).map(id => fetchJSON(`${HN_API_BASE}/item/${id}.json`))
  );
  return stories.filter(s => s && s.title);
}

// Get Ask HN stories
async function getAskStories(limit = 10) {
  const ids = await fetchJSON(`${HN_API_BASE}/askstories.json`);
  const stories = await Promise.all(
    ids.slice(0, limit).map(id => fetchJSON(`${HN_API_BASE}/item/${id}.json`))
  );
  return stories.filter(s => s && s.title);
}

// Get Show HN stories
async function getShowStories(limit = 10) {
  const ids = await fetchJSON(`${HN_API_BASE}/showstories.json`);
  const stories = await Promise.all(
    ids.slice(0, limit).map(id => fetchJSON(`${HN_API_BASE}/item/${id}.json`))
  );
  return stories.filter(s => s && s.title);
}

// Get job postings
async function getJobStories(limit = 10) {
  const ids = await fetchJSON(`${HN_API_BASE}/jobstories.json`);
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
async function searchStories(query, limit = 10, sort = 'popularity') {
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
  const { limit = 10, json = false, period = 'all', query, sort = 'popularity' } = params || {};
  
  let stories;
  let title;
  
  switch (toolName) {
    case 'hn_top':
      stories = await getTopStories(limit);
      title = '🔥 Top Stories';
      break;
    case 'hn_new':
      stories = await getNewStories(limit);
      title = '🆕 New Stories';
      break;
    case 'hn_best':
      stories = await getBestStories(limit);
      title = '⭐ Best Stories';
      break;
    case 'hn_ask':
      stories = await getAskStories(limit);
      title = '❓ Ask HN';
      break;
    case 'hn_show':
      stories = await getShowStories(limit);
      title = '👀 Show HN';
      break;
    case 'hn_jobs':
      stories = await getJobStories(limit);
      title = '💼 Jobs';
      break;
    case 'hn_ai':
      stories = await getAIStories(limit, period);
      title = '🤖 AI Domain Stories';
      break;
    case 'hn_search':
      if (!query) throw new Error('query parameter required for search');
      stories = await searchStories(query, limit, sort);
      title = `🔍 Search: "${query}"`;
      break;
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
  
  return formatOutput(stories, json, title);
}

module.exports = { execute };
