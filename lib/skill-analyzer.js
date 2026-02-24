/**
 * Skill Analyzer - 技能分析服务
 * 
 * 使用便宜 AI（DeepSeek/通义）分析技能文件
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
   * 分析技能文件
   * @param {Object} skillData - 技能数据
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
      logger.info('[SkillAnalyzer] 开始 AI 分析技能...');
      
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
   * 构建分析提示词
   */
  buildAnalysisPrompt(skillData) {
    const { skillMd, indexJs, packageJson } = skillData;
    
    return `你是一个技能安全分析专家。请分析以下技能文件，提取元数据并检查安全性。

## SKILL.md 内容
\`\`\`markdown
${skillMd || '(无)'}
\`\`\`

## index.js 内容
\`\`\`javascript
${indexJs || '(无)'}
\`\`\`

## package.json 内容
\`\`\`json
${packageJson || '(无)'}
\`\`\`

请以 JSON 格式返回分析结果，格式如下：
\`\`\`json
{
  "name": "技能名称",
  "description": "技能描述",
  "version": "版本号",
  "author": "作者",
  "tags": ["标签1", "标签2"],
  "security_score": 100,
  "security_warnings": [],
  "tools": [
    {
      "name": "工具名称",
      "description": "工具描述",
      "type": "http|script|builtin",
      "usage": "使用说明",
      "endpoint": "API 端点（如果是 http 类型）",
      "method": "HTTP 方法（如果是 http 类型）"
    }
  ]
}
\`\`\`

## 安全检查规则
1. 检查是否有 eval()、Function()、vm.compile() 等动态代码执行
2. 检查是否有访问敏感文件（/etc/passwd、.env 等）的代码
3. 检查是否有向未知服务器发送数据的代码
4. 检查是否有混淆代码或可疑的编码操作
5. 检查是否有使用 child_process 执行系统命令

## 评分标准
- 100: 完全安全，无任何风险
- 80-99: 轻微警告，如使用了 fetch 但目标明确
- 60-79: 中等风险，如使用了 child_process 但用途明确
- 40-59: 较高风险，如使用了 eval 但用途明确
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
      // 尝试提取 JSON 块
      let jsonStr = content;
      
      // 如果包含 ```json 块，提取其中的内容
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
        tags: Array.isArray(result.tags) ? result.tags : [],
        security_score: typeof result.security_score === 'number' ? result.security_score : 100,
        security_warnings: Array.isArray(result.security_warnings) ? result.security_warnings : [],
        tools: Array.isArray(result.tools) ? result.tools.map(tool => ({
          name: tool.name || '',
          description: tool.description || '',
          type: ['http', 'script', 'builtin'].includes(tool.type) ? tool.type : 'http',
          usage: tool.usage || '',
          endpoint: tool.endpoint || '',
          method: tool.method || 'GET',
        })) : [],
      };
    } catch (error) {
      logger.warn('[SkillAnalyzer] 解析 AI 响应失败:', error.message);
      // 返回默认值
      return {
        name: '',
        description: '',
        version: '',
        author: '',
        tags: [],
        security_score: 100,
        security_warnings: ['AI 响应解析失败'],
        tools: [],
      };
    }
  }

  /**
   * 基础分析（无 AI）
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
    };

    if (!skillMd) {
      return result;
    }

    // 解析 YAML frontmatter（--- 包围的开头部分）
    const frontmatterMatch = skillMd.match(/^---\s*\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      // 解析 name
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        result.name = nameMatch[1].trim();
      }
      // 解析 description
      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descMatch) {
        result.description = descMatch[1].trim();
      }
      // 解析 version
      const versionMatch = frontmatter.match(/^version:\s*(.+)$/m);
      if (versionMatch) {
        result.version = versionMatch[1].trim();
      }
      // 解析 author
      const authorMatch = frontmatter.match(/^author:\s*(.+)$/m);
      if (authorMatch) {
        result.author = authorMatch[1].trim();
      }
      // 解析 tags
      const tagsMatch = frontmatter.match(/^tags:\s*\[(.+)\]$/m);
      if (tagsMatch) {
        result.tags = tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')).filter(Boolean);
      }
    }

    const lines = skillMd.split('\n');
    let currentSection = '';
    let inToolSection = false;
    let currentTool = null;
    let inCodeBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // 跟踪代码块状态（跳过代码块内的内容）
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) {
        continue;  // 跳过代码块内的所有内容
      }

      // 解析标题
      if (trimmed.startsWith('# ')) {
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

      // 解析作者
      if (trimmed.toLowerCase().startsWith('author:') || trimmed.toLowerCase().startsWith('作者:')) {
        result.author = trimmed.split(':')[1]?.trim() || '';
      }

      // 解析标签
      if (trimmed.toLowerCase().startsWith('tags:') || trimmed.toLowerCase().startsWith('标签:')) {
        const tagsStr = trimmed.split(':')[1]?.trim() || '';
        result.tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
      }

      // 解析工具部分（支持 Tools/工具/Commands/命令 等变体）
      if (trimmed.toLowerCase().includes('## tools') || 
          trimmed.toLowerCase().includes('## 工具') ||
          trimmed.toLowerCase().includes('## commands') ||
          trimmed.toLowerCase().includes('## 命令')) {
        inToolSection = true;
        continue;
      }

      if (inToolSection) {
        // 遇到新的 ## 二级标题，结束工具部分
        if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
          // 先保存当前工具
          if (currentTool) {
            result.tools.push(currentTool);
            currentTool = null;
          }
          inToolSection = false;
          continue;
        }

        // 新的工具（只匹配 ### 三级标题）
        if (trimmed.startsWith('### ')) {
          if (currentTool) {
            result.tools.push(currentTool);
          }
          currentTool = {
            name: trimmed.replace(/^#+\s*/, ''),
            description: '',
            type: 'http',
            usage: '',
          };
          continue;
        }

        // 工具属性
        if (currentTool) {
          if (trimmed.toLowerCase().startsWith('type:')) {
            currentTool.type = trimmed.split(':')[1]?.trim() || 'http';
          } else if (trimmed.toLowerCase().startsWith('usage:') || trimmed.toLowerCase().startsWith('用法:')) {
            currentTool.usage = trimmed.split(':').slice(1).join(':').trim();
          } else if (trimmed.toLowerCase().startsWith('endpoint:')) {
            currentTool.endpoint = trimmed.split(':').slice(1).join(':').trim();
          } else if (trimmed.toLowerCase().startsWith('method:')) {
            currentTool.method = trimmed.split(':')[1]?.trim() || 'GET';
          } else if (trimmed && !trimmed.startsWith('#')) {
            currentTool.description += (currentTool.description ? ' ' : '') + trimmed;
          }
        }
      }
    }

    // 添加最后一个工具
    if (currentTool) {
      result.tools.push(currentTool);
    }

    return result;
  }

  /**
   * 安全检查（检查代码中的危险模式）
   * @param {string} code - 代码内容
   * @returns {Object} 检查结果
   */
  performSecurityCheck(code) {
    const warnings = [];
    let score = 100;

    if (!code) {
      return { score, warnings };
    }

    // 危险模式检测
    const dangerousPatterns = [
      { pattern: /eval\s*\(/, message: '使用了 eval()，可能存在代码注入风险', penalty: 30 },
      { pattern: /Function\s*\(/, message: '使用了 Function()，可能存在代码注入风险', penalty: 25 },
      { pattern: /vm\.compile/, message: '使用了 vm.compile()，可能存在代码注入风险', penalty: 25 },
      { pattern: /child_process/, message: '使用了 child_process，可能执行系统命令', penalty: 20 },
      { pattern: /exec\s*\(/, message: '使用了 exec()，可能执行系统命令', penalty: 20 },
      { pattern: /spawn\s*\(/, message: '使用了 spawn()，可能执行系统命令', penalty: 20 },
      { pattern: /\/etc\/passwd/, message: '尝试访问敏感文件 /etc/passwd', penalty: 50 },
      { pattern: /\.env/, message: '尝试访问 .env 文件', penalty: 30 },
      { pattern: /process\.env/, message: '访问环境变量（需确认用途）', penalty: 5 },
      { pattern: /fetch\s*\(\s*['"]https?:\/\/(?!api\.)/, message: '向外部服务器发送请求', penalty: 10 },
      { pattern: /atob\s*\(|btoa\s*\(/, message: '使用了 Base64 编解码', penalty: 5 },
      { pattern: /Buffer\.from\s*\([^)]*,\s*['"]base64['"]/, message: '使用了 Base64 解码', penalty: 5 },
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
