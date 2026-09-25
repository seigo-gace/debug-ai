"use strict";
const fs=require("node:fs"),path=require("node:path");
class RepoPolicy{
  constructor({workspaceRoot=process.env.DEBUG_AI_WORKSPACE_ROOT||"/workspace",allowlist=process.env.DEBUG_AI_REPO_ALLOWLIST||""}={}){
    this.workspaceRoot=path.resolve(workspaceRoot);
    this.allowlist=new Set(String(allowlist).split(",").map(x=>x.trim()).filter(Boolean));
  }
  assertRepo(repo){
    if(!repo)throw new Error("REPO_REQUIRED");
    const abs=path.resolve(String(repo));
    let real;
    try{real=fs.realpathSync(abs)}catch{throw new Error("REPO_NOT_FOUND");}
    const rootReal=fs.existsSync(this.workspaceRoot)?fs.realpathSync(this.workspaceRoot):this.workspaceRoot;
    const rel=path.relative(rootReal,real);
    if(rel.startsWith("..")||path.isAbsolute(rel))throw new Error("REPO_OUTSIDE_WORKSPACE");
    const top=rel.split(path.sep)[0];
    if(!top||top===".")throw new Error("WORKSPACE_ROOT_NOT_REPO");
    if(this.allowlist.size&&!this.allowlist.has(top))throw new Error("REPO_NOT_ALLOWLISTED");
    if(!fs.statSync(real).isDirectory())throw new Error("REPO_NOT_DIRECTORY");
    return real;
  }
}
module.exports={RepoPolicy};
