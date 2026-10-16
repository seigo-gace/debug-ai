"use strict";

const {AsyncLocalStorage}=require("node:async_hooks");

const MODES=new Set(["off","shadow","enforce"]);
const STORAGE=new AsyncLocalStorage();

function normalizeRoleSemanticMode(value){
  const mode=String(value||"").trim().toLowerCase();
  if(!MODES.has(mode))throw new Error(`ROLE_SEMANTICS_MODE_INVALID:${mode}`);
  return mode;
}
function currentRoleSemanticMode(){
  return STORAGE.getStore()?.mode||"shadow";
}
function withRoleSemanticMode(mode,fn){
  if(typeof fn!=="function")throw new Error("ROLE_SEMANTICS_CALLBACK_REQUIRED");
  const normalized=normalizeRoleSemanticMode(mode);
  return STORAGE.run(Object.freeze({mode:normalized}),fn);
}

module.exports={MODES,normalizeRoleSemanticMode,currentRoleSemanticMode,withRoleSemanticMode};
