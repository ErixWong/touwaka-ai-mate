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
