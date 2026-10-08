// 这是上游漂移护栏，不是宿主符合性护栏：套件自带 stub 主要验证引擎规范化。
// 宿主侧调用约定由 loop-bridge.test.mjs 守（两个方向的错误各能抓到 1 个失败）。
import ToolManager from "../../lib/tool-manager.js";
import { createErixToolExecutor } from "../../lib/llm-kit-adapters/loop-bridge.js";
import {
  executeToolContract,
  executeToolMigrationContract,
} from "erix-agent/contract-tests";

function createExecutor() {
  const manager = new ToolManager({}, "contract");
  return createErixToolExecutor({
    executeTool: manager.executeTool.bind(manager),
  });
}

executeToolContract("touwaka ToolManager", createExecutor);
executeToolMigrationContract("touwaka ToolManager", createExecutor);
