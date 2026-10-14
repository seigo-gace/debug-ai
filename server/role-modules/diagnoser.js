"use strict";
// Independent role configuration. Execution, state, and AI Core transport remain shared contracts.
module.exports=Object.freeze({
  name: "Diagnoser",
  alias: "debugai/diagnoser",
  authority_model: "Qwen3 8B thinking",
  backend_model: "qwen3//models/Qwen3-8B-Q4_K_M.gguf",
  thinking: true,
  timeout_ms: 600000,
  phase: "diagnosis",
  external: false,
});
