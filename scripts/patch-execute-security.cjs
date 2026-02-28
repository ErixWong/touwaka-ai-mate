// 临时脚本：修复 executeCommand 使用沙箱
const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'tools', 'builtin', 'index.js');
let content = fs.readFileSync(filePath, 'utf8');

// 检查是否已经修改过
if (content.includes('executeCommandFallback')) {
  console.log('⚠️  已经修改过，跳过');
  process.exit(0);
}

// 1. 修改 execute 方法添加权限检查（如果还没有）
if (!content.includes('Phase 2 权限检查（安全修复）')) {
  content = content.replace(
    `async execute(toolName, params, context) {
    try {
      switch (toolName) {`,
    `async execute(toolName, params, context) {
    // Phase 2 权限检查（安全修复）
    const userRole = context?.user_role || 'user';
    const validation = validateSkillAccess(userRole, toolName);
    if (!validation.allowed) {
      return {
        success: false,
        error: validation.error,
        permissionDenied: true,
      };
    }

    try {
      switch (toolName) {`
  );
  console.log('✅ 添加了权限检查');
}

// 2. 替换 executeCommand 方法
const oldExecuteCommand = `async executeCommand(params) {
    const { command, args = [], timeout = DEFAULTS.executeTimeout, cwd } = params;
    
    // 检查危险命令
    if (isDangerousCommand(command)) {
      return { success: false, error: \`Dangerous command blocked: \${command}\` };
    }
    
    // 默认使用第一个允许的根目录（skills）作为工作目录
    const workDir = cwd ? safePath(cwd) : ALLOWED_ROOTS[0];
    
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      
      // 解析命令
      let cmd = command;
      let cmdArgs = [...args];
      
      // 处理脚本文件
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
      
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          exitCode: code,
          stdout: stdout.slice(0, 10000), // 限制输出大小
          stderr: stderr.slice(0, 5000),
          timedOut
        });
      });
      
      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message
        });
      });
      
      // 超时处理
      setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout);
    });
  }`;

const newExecuteCommand = `/**
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
        console.warn(\`[executeCommand] Sandbox not available, using fallback: \${error.message}\`);
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

if (content.includes(oldExecuteCommand)) {
  content = content.replace(oldExecuteCommand, newExecuteCommand);
  console.log('✅ 替换了 executeCommand 方法');
} else {
  console.log('⚠️  未找到原始 executeCommand 方法，尝试其他方式...');
  // 尝试更宽松的匹配
  const pattern = /async executeCommand\(params\)[\s\S]*?^  \}/m;
  if (pattern.test(content)) {
    content = content.replace(pattern, newExecuteCommand.trim());
    console.log('✅ 使用正则替换了 executeCommand 方法');
  }
}

// 保存文件
fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ tools/builtin/index.js 修改完成！');