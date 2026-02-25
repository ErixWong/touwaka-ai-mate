/**
 * Skill Analyzer - 技能分析服�?
 * 
 * 使用便宜 AI（DeepSeek/通义）分析技能文�?
 * - 安全检查（检测恶意代码）
 * - 提取工具清单
 * - 生成结构化元数据
 */

import logger from './logger.js';
import https from 'https';
import http from 'http';

class SkillAnalyzer {
  /**
   * @param {Object} config - 配置对象
   * @param {string} config.apiKey - API 密钥
   * @param {string} config.baseUrl - API 基础 URL
   * @param {string} config.model - 模型名称
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.DEEPSEEK_API_KEY || '';
    this.baseUrl = config.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
    this.model = config.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.timeout = config.timeout || 60000;
  }

  /**
   * 检查是否已配置
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * 分析技能文�?
   * @param {Object} skillData - 技能数�?
   * @param {string} skillData.skillMd - SKILL.md 内容
   * @param {string} skillData.indexJs - index.js 内容（可选）
   * @param {string} skillData.packageJson - package.json 内容（可选）
   * @returns {Promise<Object>} 分析结果
   */
  async analyzeSkill(skillData) {
    if (!this.isConfigured()) {
      logger.warn('[SkillAnalyzer] AI API 未配置，使用基础解析');
      return this.basicAnalysis(skillData);
    }

    const prompt = this.buildAnalysisPrompt(skillData);
    
    try {
      logger.info('[SkillAnalyzer] 开�?AI 分析技�?..');
      
      const response = await this.callLLM(prompt);
      const result = this.parseAnalysisResult(response);
      
      logger.info('[SkillAnalyzer] AI 分析完成', {
        security_score: result.security_score,
        tools_count: result.tools?.length || 0,
        warnings: result.security_warnings?.length || 0,
      });
      
      return result;
    } catch (error) {
      logger.error('[SkillAnalyzer] AI 分析失败:', error.message);
      // 降级到基础解析
      return this.basicAnalysis(skillData);
    }
  }

  /**
   * 构建分析提示�?
   */
  buildAnalysisPrompt(skillData) {
    const { skillMd, indexJs, packageJson } = skillData;
    
    return `你是一个技能安全分析专家。请分析以下技能文件，提取元数据并检查安全性�?

## SKILL.md 内容
\`\`\`markdown
${skillMd || '(�?'}
\`\`\`

## index.js 内容
\`\`\`javascript
${indexJs || '(�?'}
\`\`\`

## package.json 内容
\`\`\`json
${packageJson || '(�?'}
\`\`\`

请以 JSON 格式返回分析结果，格式如下：
\`\`\`json
{
  "name": "技能名�?,
  "description": "技能描述（简短，不超�?00字）",
  "version": "版本�?,
  "author": "作�?,
  "license": "MIT/Apache-2.0/Proprietary",
  "tags": ["标签1", "标签2"],
  "security_score": 100,
  "security_warnings": [],
  "argument_hint": "参数提示（可选）",
  "disable_model_invocation": false,
  "user_invocable": true,
  "allowed_tools": ["tool1", "tool2"],
  "tools": [
    {
      "name": "工具名称",
      "description": "工具描述",
      "parameters": "使用说明（JSON格式的参数定义）"
    }
  ]
}
\`\`\`

## 安全检查规�?
1. 检查是否有 eval()、Function()、vm.compile() 等动态代码执�?
2. 检查是否有访问敏感文件�?etc/passwd�?env 等）的代�?
3. 检查是否有向未知服务器发送数据的代码
4. 检查是否有混淆代码或可疑的编码操作
5. 检查是否有使用 child_process 执行系统命令

## 评分标准
- 100: 完全安全，无任何风险
- 80-99: 轻微警告，如使用�?fetch 但目标明�?
- 60-79: 中等风险，如使用�?child_process 但用途明�?
- 40-59: 较高风险，如使用�?eval 但用途明�?
- 0-39: 高风险，存在明显恶意代码

请只返回 JSON，不要包含其他内容。`;
  }

  /**
   * 调用 LLM API
   */
  async callLLM(prompt) {
    return new Promise((resolve, reject) => {
      const requestBody = JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3, // 低温度以获得更一致的结果
        max_tokens: 4096,
      });

      const url = new URL(this.baseUrl);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}/chat/completions`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Length': Buffer.byteLength(requestBody),
        },
        timeout: this.timeout,
      };

      logger.debug('[SkillAnalyzer] 请求 LLM API:', {
        url: `${requestOptions.hostname}${requestOptions.path}`,
        model: this.model,
        prompt_length: prompt.length,
      });

      const req = httpModule.request(requestOptions, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
              return;
            }
            
            const response = JSON.parse(data);
            const content = response.choices?.[0]?.message?.content;
            
            if (!content) {
              reject(new Error('LLM 响应为空'));
              return;
            }
            
            resolve(content);
          } catch (error) {
            reject(new Error(`解析响应失败: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`请求失败: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * 解析分析结果
   */
  parseAnalysisResult(content) {
    try {
      // 尝试提取 JSON �?
      let jsonStr = content;
      
      // 如果包含 ```json 块，提取其中的内�?
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      
      const result = JSON.parse(jsonStr);
      
      // 验证并规范化结果
      return {
        name: result.name || '',
        description: result.description || '',
        version: result.version || '',
        author: result.author || '',
        license: result.license || '',
        tags: Array.isArray(result.tags) ? result.tags : [],
        security_score: typeof result.security_score === 'number' ? result.security_score : 100,
        security_warnings: Array.isArray(result.security_warnings) ? result.security_warnings : [],
        // Claude Code 标准扩展字段
        argument_hint: result.argument_hint || '',
        disable_model_invocation: result.disable_model_invocation === true,
        user_invocable: result.user_invocable !== false,
        allowed_tools: Array.isArray(result.allowed_tools) ? result.allowed_tools : [],
        tools: Array.isArray(result.tools) ? result.tools.map(tool => ({
          name: tool.name || '',
          description: tool.description || '',
          parameters: tool.parameters || '',
        })) : [],
      };
    } catch (error) {
      logger.warn('[SkillAnalyzer] 解析 AI 响应失败:', error.message);
      // 返回默认�?
      return {
        name: '',
        description: '',
        version: '',
        author: '',
        license: '',
        tags: [],
        security_score: 100,
        security_warnings: ['AI 响应解析失败'],
        argument_hint: '',
        disable_model_invocation: false,
        user_invocable: true,
        allowed_tools: [],
        tools: [],
      };
    }
  }

  /**
   * 基础分析（无 AI�?
   * 支持 Claude Code Skills 标准�?frontmatter 解析
   * @see https://code.claude.com/docs/en/skills
   */
  basicAnalysis(skillData) {
    const { skillMd } = skillData;
    
    // 使用简单的 SKILL.md 解析
    const result = {
      name: '',
      description: '',
      version: '',
      author: '',
      tags: [],
      security_score: 100,
      security_warnings: [],
      tools: [],
      // Claude Code 标准字段
      argument_hint: '',
      disable_model_invocation: false,
      user_invocable: true,
      allowed_tools: [],
      model: '',
      context: '',
      agent: '',
      license: '',
    };

    if (!skillMd) {
      return result;
    }

    // 解析 YAML frontmatter�?-- 包围的开头部分）
    const frontmatterMatch = skillMd.match(/^---\s*\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      
      // 使用改进�?YAML 解析
      const frontmatterData = this.parseYamlFrontmatter(frontmatter);
      
      // 基础字段
      result.name = frontmatterData.name || '';
      result.description = frontmatterData.description || '';
      result.version = frontmatterData.version || '';
      result.author = frontmatterData.author || '';
      result.tags = frontmatterData.tags || [];
      result.license = frontmatterData.license || '';
      
      // Claude Code 标准字段
      result.argument_hint = frontmatterData['argument-hint'] || '';
      result.disable_model_invocation = frontmatterData['disable-model-invocation'] === true;
      result.user_invocable = frontmatterData['user-invocable'] !== false; // 默认 true
      result.allowed_tools = frontmatterData['allowed-tools'] || [];
      result.model = frontmatterData.model || '';
      result.context = frontmatterData.context || '';
      result.agent = frontmatterData.agent || '';
    }

    const lines = skillMd.split('\n');
    let currentSection = '';
    let inToolSection = false;
    let currentTool = null;
    let inCodeBlock = false;
    let hasFrontmatterName = !!result.name; // 记录 frontmatter 中是否有 name

    for (const line of lines) {
      const trimmed = line.trim();

      // 跳过 frontmatter 部分
      if (trimmed === '---') {
        continue;
      }

      // 跟踪代码块状态（跳过代码块内的内容）
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) {
        continue;  // 跳过代码块内的所有内�?
      }

      // 解析标题（仅�?frontmatter 中没�?name 时才使用标题�?
      if (trimmed.startsWith('# ') && !hasFrontmatterName) {
        result.name = trimmed.substring(2).trim();
        continue;
      }

      // 解析字段
      if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
        currentSection = trimmed.slice(2, -2).toLowerCase();
        continue;
      }

      // 解析描述
      if (currentSection === 'description' && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('**')) {
        result.description += (result.description ? ' ' : '') + trimmed;
      }

      // 解析版本
      if (trimmed.toLowerCase().startsWith('version:') || trimmed.toLowerCase().startsWith('版本:')) {
        result.version = trimmed.split(':')[1]?.trim() || '';
      }

      // 解析作�?
      if (trimmed.toLowerCase().startsWith('author:') || trimmed.toLowerCase().startsWith('作�?')) {
        result.author = trimmed.split(':')[1]?.trim() || '';
      }

      // 解析标签
      if (trimmed.toLowerCase().startsWith('tags:') || trimmed.toLowerCase().startsWith('标签:')) {
        const tagsStr = trimmed.split(':')[1]?.trim() || '';
        result.tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
      }

      // 解析工具部分（支�?Tools/工具/Commands/命令 等变体）
      if (trimmed.toLowerCase().includes('## tools') || 
          trimmed.toLowerCase().includes('## 工具') ||
          trimmed.toLowerCase().includes('## commands') ||
          trimmed.toLowerCase().includes('## 命令')) {
        inToolSection = true;
        continue;
      }

      if (inToolSection) {
        // 遇到新的 ## 二级标题，结束工具部�?
        if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
          // 先保存当前工�?
          if (currentTool) {
            result.tools.push(currentTool);
            currentTool = null;
          }
          inToolSection = false;
          continue;
        }

        // 新的工具（只匹配 ### 三级标题�?
        if (trimmed.startsWith('### ')) {
          if (currentTool) {
            result.tools.push(currentTool);
          }
          currentTool = {
            name: trimmed.replace(/^#+\s*/, ''),
            description: '',
            parameters: '',
          };
          continue;
        }

        // 工具属�?
        if (currentTool) {
          if (trimmed.toLowerCase().startsWith('parameters:') || trimmed.toLowerCase().startsWith('参数:')) {
            currentTool.parameters = trimmed.split(':').slice(1).join(':').trim();
          } else if (trimmed && !trimmed.startsWith('#')) {
            currentTool.description += (currentTool.description ? ' ' : '') + trimmed;
          }
        }
      }
    }

    // 添加最后一个工�?
    if (currentTool) {
      result.tools.push(currentTool);
    }

    return result;
  }

  /**
   * 解析 YAML frontmatter
   * 支持多行字符串、数组和基本类型
   * @param {string} frontmatter - YAML frontmatter 内容
   * @returns {Object} 解析结果
   */
  parseYamlFrontmatter(frontmatter) {
    const result = {};
    const lines = frontmatter.split('\n');
    let currentKey = null;
    let currentValue = [];
    let isArray = false;
    let isMultiline = false;
    let multilineIndicator = '';

    const flushValue = () => {
      if (currentKey !== null) {
        let value;
        if (isMultiline) {
          // 多行字符串，移除缩进
          value = currentValue.join('\n').trim();
        } else if (isArray) {
          value = currentValue;
        } else if (currentValue.length === 1) {
          value = currentValue[0];
        } else {
          value = currentValue.join(' ').trim();
        }
        
        // 类型转换
        if (!isArray && typeof value === 'string') {
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (/^\d+$/.test(value)) value = parseInt(value, 10);
          else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
        }
        
        result[currentKey] = value;
        currentKey = null;
        currentValue = [];
        isArray = false;
        isMultiline = false;
        multilineIndicator = '';
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // 跳过空行和注�?
      if (!trimmed || trimmed.startsWith('#')) {
        if (isMultiline) {
          currentValue.push('');
        }
        continue;
      }

      // 处理多行字符串内�?
      if (isMultiline) {
        // 检查是否回到顶级（没有缩进�?
        if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.includes(':')) {
          flushValue();
          // 继续处理当前�?
        } else {
          // 保留缩进，添加到当前�?
          currentValue.push(line);
          continue;
        }
      }

      // 处理数组�?
      if (isArray && trimmed.startsWith('- ')) {
        const item = trimmed.substring(2).trim();
        // 移除引号
        const cleanItem = item.replace(/^['"]|['"]$/g, '');
        currentValue.push(cleanItem);
        continue;
      }

      // 检测键值对
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        flushValue();
        
        const key = trimmed.substring(0, colonIndex).trim();
        let value = trimmed.substring(colonIndex + 1).trim();
        
        currentKey = key;
        
        // 检查是否是数组格式 [...]
        if (value.startsWith('[') && value.endsWith(']')) {
          const arrayContent = value.slice(1, -1).trim();
          if (arrayContent) {
            currentValue = arrayContent.split(',').map(item =>
              item.trim().replace(/^['"]|['"]$/g, '')
            ).filter(Boolean);
          } else {
            currentValue = [];
          }
          isArray = true;
          flushValue();
          continue;
        }
        
        // 检查是否是多行字符�?| �?>
        if (value === '|' || value === '>') {
          isMultiline = true;
          multilineIndicator = value;
          currentValue = [];
          continue;
        }
        
        // 检查是否是数组（值在下一行以 - 开始）
        if (value === '' || value === '[]') {
          // 检查下一行是否是数组�?
          const nextLine = lines[i + 1]?.trim();
          if (nextLine?.startsWith('- ')) {
            isArray = true;
            currentValue = [];
            continue;
          }
          // 空�?
          result[currentKey] = '';
          currentKey = null;
          continue;
        }
        
        // 普通值，移除引号
        currentValue = [value.replace(/^['"]|['"]$/g, '')];
        flushValue();
      }
    }

    // 处理最后一个�?
    flushValue();

    return result;
  }

  /**
   * 安全检查（检查代码中的危险模式）
   * @param {string} code - 代码内容
   * @returns {Object} 检查结�?
   */
  performSecurityCheck(code) {
    const warnings = [];
    let score = 100;

    if (!code) {
      return { score, warnings };
    }

    // Dangerous pattern detection
    const dangerousPatterns = [
      { pattern: /eval\s*\(/, message: 'Using eval(), potential code injection risk', penalty: 30 },
      { pattern: /Function\s*\(/, message: 'Using Function(), potential code injection risk', penalty: 25 },
      { pattern: /vm\.compile/, message: 'Using vm.compile(), potential code injection risk', penalty: 25 },
      { pattern: /child_process/, message: 'Using child_process, may execute system commands', penalty: 20 },
      { pattern: /exec\s*\(/, message: 'Using exec(), may execute system commands', penalty: 20 },
      { pattern: /spawn\s*\(/, message: 'Using spawn(), may execute system commands', penalty: 20 },
      { pattern: /\/etc\/passwd/, message: 'Attempting to access sensitive file /etc/passwd', penalty: 50 },
      { pattern: /\.env/, message: 'Attempting to access .env file', penalty: 30 },
      { pattern: /process\.env/, message: 'Accessing environment variables (verify purpose)', penalty: 5 },
      { pattern: /fetch\s*\(\s*['"]https?:\/\/(?!api\.)/, message: 'Sending requests to external servers', penalty: 10 },
      { pattern: /atob\s*\(|btoa\s*\(/, message: 'Using Base64 encoding/decoding', penalty: 5 },
      { pattern: /Buffer\.from\s*\([^)]*,\s*['"]base64['"]/, message: 'Using Base64 decoding', penalty: 5 },
    ];

    for (const { pattern, message, penalty } of dangerousPatterns) {
      if (pattern.test(code)) {
        warnings.push(message);
        score = Math.max(0, score - penalty);
      }
    }

    return { score, warnings };
  }
}

export default SkillAnalyzer;
