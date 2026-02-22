-- ============================================
-- 数据库种子数据
-- 用于初始化测试数据
-- ============================================

-- 插入 Provider 配置
INSERT INTO providers (id, name, base_url, api_key) VALUES
('openai', 'OpenAI', 'https://api.openai.com/v1', '${OPENAI_API_KEY}'),
('custom', 'Custom API', 'https://api2.ai.erix.vip/v1', '${API_KEY}'),
('ollama', 'Ollama Local', 'http://localhost:11434/v1', 'ollama')
ON DUPLICATE KEY UPDATE
  base_url = VALUES(base_url),
  api_key = VALUES(api_key);

-- 插入 Models 配置
INSERT INTO models (id, provider_id, model_name, context_size, max_tokens) VALUES
('deepseek-chat', 'custom', 'deepseek-chat', 128000, 4096),
('glm-4', 'custom', 'glm-4', 128000, 4096),
('glm-4-flash', 'custom', 'glm-4-flash', 128000, 4096),
('gpt-4', 'openai', 'gpt-4-turbo', 128000, 4096),
('gpt-3.5-turbo', 'openai', 'gpt-3.5-turbo', 16385, 4096),
('llama3', 'ollama', 'llama3.1:8b', 128000, 4096)
ON DUPLICATE KEY UPDATE
  model_name = VALUES(model_name),
  context_size = VALUES(context_size);

-- 插入专家 Eric
INSERT INTO experts (
  id, 
  name, 
  introduction, 
  speaking_style,
  core_values, 
  taboos, 
  emotional_tone,
  expressive_model, 
  reflective_model
) VALUES (
  'eric',
  'Eric',
  '34岁，程序员，来自镇江，现在在上海B站工作。正在参加相亲。喜欢技术、游戏和动漫。',
  '用程序员的方式表达，保持自信但不自负，偶尔说一些镇江话，适当幽默',
  '["真诚待人，不欺骗", "尊重对方的选择和边界", "保持适度的幽默感", "坦诚面对自己的优缺点"]',
  '["不尊重对方", "强迫对方做不愿意的事", "说谎或欺骗", "过度炫耀", "消极悲观"]',
  '温和、自信、幽默、略带 nerd 气质',
  'deepseek-chat',
  'glm-4-flash'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  introduction = VALUES(introduction),
  speaking_style = VALUES(speaking_style),
  core_values = VALUES(core_values),
  taboos = VALUES(taboos),
  emotional_tone = VALUES(emotional_tone),
  expressive_model = VALUES(expressive_model),
  reflective_model = VALUES(reflective_model);

-- 插入专家 Linda
INSERT INTO experts (
  id, 
  name, 
  introduction, 
  speaking_style,
  core_values, 
  taboos, 
  emotional_tone,
  expressive_model, 
  reflective_model
) VALUES (
  'linda',
  'Linda',
  '28岁，产品经理，在上海互联网公司工作。性格开朗，喜欢运动和旅行。',
  '直接、有条理，善于倾听，偶尔幽默',
  '["真诚交流", "尊重彼此空间", "保持好奇心", "乐观面对生活"]',
  '["不尊重", "过度依赖", "消极抱怨", "言而无信"]',
  '开朗、直接、温暖',
  'deepseek-chat',
  'glm-4-flash'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  introduction = VALUES(introduction),
  speaking_style = VALUES(speaking_style),
  core_values = VALUES(core_values),
  taboos = VALUES(taboos),
  emotional_tone = VALUES(emotional_tone),
  expressive_model = VALUES(expressive_model),
  reflective_model = VALUES(reflective_model);

-- 插入技能 - 天气查询（数据库模式）
INSERT INTO skills (id, name, description, source_type, skill_md, index_js) VALUES
('weather', 'Weather', '查询指定城市的天气信息', 'database', 
'# Weather Skill

查询天气信息，包括温度、天气状况等。

## 工具

### get_weather
获取指定城市的天气信息。

**参数**：
- `city` (string): 城市名称
- `days` (number): 预报天数，默认 1
', 
'module.exports = {
  name: "weather",
  description: "查询指定城市的天气信息",
  
  getTools() {
    return [{
      type: "function",
      function: {
        name: "get_weather",
        description: "获取指定城市的天气信息",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string", description: "城市名称" },
            days: { type: "number", description: "预报天数", default: 1 }
          },
          required: ["city"]
        }
      }
    }];
  },
  
  async execute(toolName, params, context) {
    const { city, days = 1 } = params;
    // 模拟天气数据
    const conditions = ["晴", "多云", "阴", "小雨"];
    const condition = conditions[Math.floor(Math.random() * conditions.length)];
    const temp = 20 + Math.floor(Math.random() * 10);
    
    return {
      success: true,
      data: { city, condition, temp, days },
      summary: `${city}今天${condition}，温度${temp}°C`
    };
  }
};'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  skill_md = VALUES(skill_md),
  index_js = VALUES(index_js);

-- 插入技能 - 网络搜索（数据库模式）
INSERT INTO skills (id, name, description, source_type, skill_md, index_js) VALUES
('search', 'Search', '搜索互联网获取实时信息', 'database',
'# Search Skill

搜索互联网获取信息。

## 工具

### web_search
搜索互联网内容。

**参数**：
- `query` (string): 搜索关键词
- `maxResults` (number): 最大结果数，默认 5
',
'module.exports = {
  name: "search",
  description: "搜索互联网获取实时信息",
  
  getTools() {
    return [{
      type: "function",
      function: {
        name: "web_search",
        description: "搜索互联网获取信息",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词" },
            maxResults: { type: "number", description: "最大结果数", default: 5 }
          },
          required: ["query"]
        }
      }
    }];
  },
  
  async execute(toolName, params, context) {
    const { query, maxResults = 5 } = params;
    // 模拟搜索结果
    return {
      success: true,
      data: {
        query,
        results: [
          { title: `关于${query}的结果1`, url: "https://example.com/1" },
          { title: `关于${query}的结果2`, url: "https://example.com/2" }
        ]
      },
      summary: `找到关于"${query}"的搜索结果`
    };
  }
};'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  skill_md = VALUES(skill_md),
  index_js = VALUES(index_js);

-- 插入技能 - 文件系统模式示例
INSERT INTO skills (id, name, description, source_type, source_path) VALUES
('calculator', 'Calculator', '数学计算工具', 'filesystem', '/shared/skills/calculator/')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  source_type = VALUES(source_type),
  source_path = VALUES(source_path);

-- 为 Eric 启用技能
INSERT INTO expert_skills (expert_id, skill_id, is_enabled, config) VALUES
('eric', 'weather', TRUE, '{}'),
('eric', 'search', TRUE, '{}'),
('eric', 'calculator', FALSE, '{}')
ON DUPLICATE KEY UPDATE
  is_enabled = VALUES(is_enabled);

-- 为 Linda 启用技能
INSERT INTO expert_skills (expert_id, skill_id, is_enabled, config) VALUES
('linda', 'weather', TRUE, '{}'),
('linda', 'search', FALSE, '{}')
ON DUPLICATE KEY UPDATE
  is_enabled = VALUES(is_enabled);

-- 创建测试用户
INSERT INTO users (id, email, real_name) VALUES
('test_user_001', 'test@example.com', 'Test User')
ON DUPLICATE KEY UPDATE
  real_name = VALUES(real_name);

-- 创建用户在专家面前的印象档案
INSERT INTO user_profiles (expert_id, user_id, preferred_name, introduction, background) VALUES
('eric', 'test_user_001', 'Eric朋友', '你好，我是Eric的朋友，想和你聊聊技术话题', '喜欢技术的用户，对编程和AI感兴趣'),
('linda', 'test_user_001', '小王', '你好，我是小王，想和你聊聊生活', '性格开朗，喜欢运动和旅行的用户')
ON DUPLICATE KEY UPDATE
  preferred_name = VALUES(preferred_name),
  introduction = VALUES(introduction);

-- 插入测试消息
INSERT INTO messages (expert_id, user_id, role, content) VALUES
('eric', 'test_user_001', 'user', '你好，我想测试一下系统'),
('eric', 'test_user_001', 'assistant', '你好！系统运行正常，很高兴为你服务。有什么我可以帮助你的吗？')
ON DUPLICATE KEY UPDATE
  content = VALUES(content);

SELECT 'Seed data inserted successfully' AS status;
