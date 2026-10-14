"use strict";
// Independent role configuration. Execution, state, and AI Core transport remain shared contracts.
module.exports=Object.freeze({
  name: "Local Reviewer",
  alias: "debugai/local-reviewer",
  authority_model: "Ministral 3 8B Reasoning",
  backend_model: "ministral//models/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf",
  thinking: null,
  phase: "review",
  external: false,
});
