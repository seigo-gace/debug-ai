"use strict";
// Independent role configuration. Execution, state, and AI Core transport remain shared contracts.
module.exports=Object.freeze({
  name: "Causal Scout",
  alias: "debugai/causal-scout",
  authority_model: "Qwen3 8B non-thinking",
  backend_model: "qwen3//models/Qwen3-8B-Q4_K_M.gguf",
  thinking: false,
  phase: "scout",
  external: false,
});
