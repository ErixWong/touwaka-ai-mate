const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'index.js');
let content = fs.readFileSync(filePath, 'utf8');

// 检查语法错误
try {
  new Function(content);
  console.log('✓ 语法正确');
} catch (e) {
  console.log('✗ 语法错误:', e.message);
  
  // 尝试修复
  const broken = /return \{ valid: true, fullPath, relativePath \};\s*\/\*\*\r?\n\}\r?\n \* 获取数据库连接/;
  if (broken.test(content)) {
    console.log('发现错误模式，尝试修复...');
    content = content.replace(broken, 'return { valid: true, fullPath, relativePath };\n}\n\n/**\n * 获取数据库连接');
    fs.writeFileSync(filePath, content);
    console.log('✓ 已修复');
  } else {
    // 输出错误区域
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (i >= 150 && i <= 160) {
        console.log(`${i+1}: ${JSON.stringify(line)}`);
      }
    });
  }
}
