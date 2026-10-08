import { engineApiContract } from "erix-agent/contract-tests";

engineApiContract(
  "touwaka erix-agent package entry",
  () => import("erix-agent"),
);
