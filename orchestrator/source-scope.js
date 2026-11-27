"use strict";
const path=require("node:path");
// Existing .gitignore/.dockerignore parent-owned workspace roots. They are
// separate revisions or verification material, not the selected product tree.
const PARENT_OWNED_SOURCE_ROOTS=Object.freeze([".worktrees",".verification"]);
function isParentOwnedSourcePath(value){
  const rel=path.posix.normalize(String(value??"").replace(/\\/g,"/"));
  return PARENT_OWNED_SOURCE_ROOTS.includes(rel.split("/")[0]);
}
module.exports={PARENT_OWNED_SOURCE_ROOTS,isParentOwnedSourcePath};
