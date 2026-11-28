"use strict";
const path=require("node:path");
// Existing .gitignore/.dockerignore workspace boundaries. Parent worktrees,
// verification material and Host-owned runtime request queues are not source.
const PARENT_OWNED_SOURCE_ROOTS=Object.freeze([".worktrees",".verification",".debugai-input"]);
function isParentOwnedSourcePath(value){
  const rel=path.posix.normalize(String(value??"").replace(/\\/g,"/"));
  return PARENT_OWNED_SOURCE_ROOTS.includes(rel.split("/")[0]);
}
module.exports={PARENT_OWNED_SOURCE_ROOTS,isParentOwnedSourcePath};
