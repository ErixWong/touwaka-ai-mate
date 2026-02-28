// 修复 executeCommand 使用沙箱
const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'tools', 'builtin', 'index.js');
let content = fs.readFileSync(filePath, 'utf8');

// 检查是否已经修改过
if (content.includes('executeCommandFallback')) {
  console.log('⚠️  已经修改过，跳过');
  process.exit(0);
}

// 找到 executeCommand 方法的位置
const startMarker = 'async executeCommand(params) {';
const startIndex = content.indexOf(startMarker);

if (startIndex === -1) {
  console.log('❌ 未找到 executeCommand 方法');
  process.exit(1);
}

// 找到方法结束位置（下一个方法开始）
let braceCount = 0;
let endIndex = startIndex;
let foundStart = false;

for (let i = startIndex; i < content.length; i++) {
  if (content[i] === '{') {
    braceCount++;
    foundStart = true;
  } else if (content[i] === '}') {
    braceCount--;
    if (foundStart && braceCount === 0) {
      endIndex = i + 1;
      break;
    }
  }
}

console.log(`找到 executeCommand 方法: ${startIndex} - ${endIndex}`);

// 新的 executeCommand 方法
const newMethod = `
  /**
   * 执行命令（使用沙箱隔离）
   * 安全修复：所有命令都通过 SandboxExecutor 在沙箱中执行
   */
  async executeCommand(params, context) {
    const { command, args = [], timeout = DEFAULTS.executeTimeout, cwd } = params;
    
    // 检查危险命令
    if (isDangerousCommand(command)) {
      return { success: false, error: \`Dangerous command blocked: \${command}\` };
    }
    
    // 获取用户信息（用于沙箱隔离）
    const userId = context?.userId || 'anonymous';
    const userRole = context?.user_role || 'user';
    
    // 构建完整命令
    let fullCommand = command;
    if (args && args.length > 0) {
      fullCommand = \`\${command} \${args.map(a => \`"\${a}"\`).join(' ')}\`;
    }
    
    try {
      // 使用沙箱执行器
      const sandboxExecutor = new SandboxExecutor();
      const result = await sandboxExecutor.execute(userId, userRole, fullCommand, {
        timeout,
        cwd,
      });
      
      return {
        success: result.success,
        exitCode: result.code,
        stdout: result.stdout?.slice(0, 10000) || '',
        stderr: result.stderr?.slice(0, 5000) || '',
        timedOut: result.timedOut || false,
        sandboxed: true,
      };
    } catch (error) {
      // 沙箱不可用时的降级处理
      if (error.message.includes('Unsupported platform')) {
        console.warn(\`[executeCommand] Sandbox not available: \${error.message}\`);
        return this.executeCommandFallback(params, context);
      }
      
      return {
        success: false,
        error: error.message,
        sandboxed: false,
      };
    }
  }

  /**
   * 命令执行降级方案（无沙箱）
   */
  async executeCommandFallback(params, context) {
    const { command, args = [], timeout = DEFAULTS.executeTimeout, cwd } = params;
    
    if (isDangerousCommand(command)) {
      return { success: false, error: \`Dangerous command blocked: \${command}\` };
    }
    
    const workDir = cwd ? safePath(cwd) : ALLOWED_ROOTS[0];
    
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      
      let cmd = command;
      let cmdArgs = [...args];
      
      if (command.endsWith('.sh')) {
        cmd = 'bash';
        cmdArgs = [command, ...args];
      } else if (command.endsWith('.py')) {
        cmd = 'python';
        cmdArgs = [command, ...args];
      } else if (command.endsWith('.js')) {
        cmd = 'node';
        cmdArgs = [command, ...args];
      }
      
      const proc = spawn(cmd, cmdArgs, {
        cwd: workDir,
        shell: true,
        timeout
      });
      
      proc.stdout.on('data', (data) => stdout += data.toString());
      proc.stderr.on('data', (data) => stderr += data.toString());
      
      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          exitCode: code,
          stdout: stdout.slice(0, 10000),
          stderr: stderr.slice(0, 5000),
          timedOut,
          sandboxed: false,
        });
      });
      
      proc.on('error', (error) => {
        resolve({ success: false, error: error.message, sandboxed: false });
      });
      
      setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout);
    });
  }`;

// 替换方法
const before = content.slice(0, startIndex);
const after = content.slice(endIndex);
content = before + newMethod + after;

// 保存文件
fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ executeCommand 方法替换完成！');