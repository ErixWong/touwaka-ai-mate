/**
 * Weather Skill - 天气查询技能
 * 
 * 这是一个示例技能，展示如何创建自定义工具。
 * 实际使用时需要接入真实的天气 API。
 */

export default {
  name: 'weather',
  description: '查询指定城市的天气信息',

  /**
   * 定义本技能提供的工具
   * @returns {Array} OpenAI 格式的工具定义
   */
  getTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: '获取指定城市的天气信息，包括温度、天气状况等',
          parameters: {
            type: 'object',
            properties: {
              city: {
                type: 'string',
                description: '城市名称，如"上海"、"北京"'
              },
              days: {
                type: 'number',
                description: '预报天数（1-7），默认为1',
                default: 1
              }
            },
            required: ['city']
          }
        }
      }
    ];
  },

  /**
   * 执行工具调用
   * @param {string} toolName - 工具名称
   * @param {Object} params - 工具参数
   * @param {Object} context - 执行上下文
   * @returns {Object} 执行结果
   */
  async execute(toolName, params, context) {
    if (toolName !== 'get_weather') {
      return {
        success: false,
        error: `Unknown tool: ${toolName}`
      };
    }

    const { city, days = 1 } = params;

    // 这里应该调用真实的天气 API
    // 现在返回模拟数据作为示例
    try {
      const weatherData = await this.fetchWeather(city, days);
      
      return {
        success: true,
        data: weatherData,
        summary: `${city}当前温度${weatherData.current.temp}°C，${weatherData.current.condition}`
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get weather: ${error.message}`
      };
    }
  },

  /**
   * 获取天气数据（模拟实现）
   * 实际使用时应调用天气 API，如和风天气、OpenWeatherMap 等
   */
  async fetchWeather(city, days) {
    // 模拟天气数据
    const conditions = ['晴', '多云', '阴', '小雨', '中雨'];
    const baseTemp = {
      '上海': 25, '北京': 22, '广州': 28, '深圳': 29,
      '杭州': 24, '南京': 23, '成都': 21, '武汉': 26
    }[city] || 24;

    const forecast = [];
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      
      const tempVariation = Math.floor(Math.random() * 6) - 3;
      const condition = conditions[Math.floor(Math.random() * conditions.length)];
      
      forecast.push({
        date: date.toISOString().split('T')[0],
        temp: `${baseTemp + tempVariation - 3}-${baseTemp + tempVariation + 3}`,
        condition: condition
      });
    }

    return {
      city: city,
      current: {
        temp: baseTemp,
        condition: forecast[0].condition,
        humidity: `${50 + Math.floor(Math.random() * 30)}%`,
        wind: `${['东', '南', '西', '北'][Math.floor(Math.random() * 4)]}风 ${Math.floor(Math.random() * 4) + 1}级`
      },
      forecast: forecast
    };
  }
};
