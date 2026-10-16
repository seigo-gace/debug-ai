"use strict";
// Independent role configuration. Execution, state, and AI Core transport remain shared contracts.
module.exports=Object.freeze({
  name: "Code Scout",
  alias: "debugai/code-scout",
  authority_model: "Qwen2.5-Coder 7B",
  backend_model: "coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
  thinking: null,
  phase: "scout",
  external: false,
});
