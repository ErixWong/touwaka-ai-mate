const fs = require('fs');
const code = fs.readFileSync('./index.js', 'utf8');
try {
  require('./index.js');
  console.log('✓ 脚本加载成功');
} catch (e) {
  console.log('✗ 错误:', e.message);
  const match = e.message.match(/:(\d+):/);
  if (match) {
    const line = parseInt(match[1]);
    const lines = code.split('\n');
    for (let i = Math.max(0, line - 5); i < Math.min(lines.length, line + 3); i++) {
      console.log(`${i+1}: ${lines[i]}`);
    }
  }
}
