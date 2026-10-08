// 这是上游漂移护栏，不是宿主符合性护栏：本契约验证发布包 API 与引擎侧行为。
// 宿主侧调用约定由 loop-bridge.test.mjs 守（两个方向的错误各能抓到 1 个失败）。
import { engineApiContract } from "erix-agent/contract-tests";

engineApiContract(
  "touwaka erix-agent package entry",
  () => import("erix-agent"),
);
