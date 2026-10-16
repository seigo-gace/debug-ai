"use strict";
// Independent role configuration. Execution, state, and AI Core transport remain shared contracts.
module.exports=Object.freeze({
  name: "Researcher",
  alias: "debugai/researcher",
  authority_model: "Granite 4.2 8B non-thinking",
  backend_model: "granite//models/granite-4.2-8b-Q4_K_M.gguf",
  thinking: false,
  timeout_ms: 600000,
  phase: "research",
  external: false,
});
