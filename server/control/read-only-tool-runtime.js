"use strict";
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {RepoPolicy}=require("../repo-policy.js");
const {extractSpecifiers}=require("../../orchestrator/context-core.js");
const {getRoleContract}=require("./role-contracts.js");
const {getSkill}=require("./skill-registry.js");
const {assertToolAdmission}=require("./tool-risk.js");

const SEARCH_EXT=/\.(?:[cm]?[jt]sx?|json|md|py|go|rs|java|kt|kts|cs|cpp|cc|c|h|hpp|rb|php|swift|vue|svelte|toml|ya?ml|css|scss|html)$/i;
const SKIP_DIRS=new Set([".git","node_modules","dist","build","coverage",".next",".cache","runtime"]);
const AVAILABLE_TOOLS=Object.freeze(["source.read","source.search","dependency.map","knowledge.search","authority.search"]);

function sha256(v){return crypto.createHash("sha256").update(v).digest("hex");}
function normalizeRel(value){
  const rel=String(value||"").replace(/\\/g,"/").replace(/^\.\//,"");
  if(!rel||path.posix.isAbsolute(rel)||/^[A-Za-z]:\//.test(rel)||rel.split("/").includes(".."))throw new Error("READ_PATH_INVALID");
  return rel;
}
function blockedReadPath(rel){
  const p=normalizeRel(rel).toLowerCase();
  return p===".git"||p.startsWith(".git/")||p.includes("/.git/")||p==="secrets"||p.startsWith("secrets/")||p.includes("/secrets/")||/(^|\/)\.env($|\.)/.test(p)||/\.(pem|key|p12|pfx)$/.test(p);
}
function resolveSafeFile(repo,rel){
  const safe=normalizeRel(rel);if(blockedReadPath(safe))throw new Error(`READ_PROTECTED_PATH:${safe}`);
  const root=fs.realpathSync(repo);const full=path.resolve(root,safe);const prefix=root.endsWith(path.sep)?root:root+path.sep;
  if(full!==root&&!full.startsWith(prefix))throw new Error(`READ_PATH_ESCAPE:${safe}`);
  if(!fs.existsSync(full))throw new Error(`READ_FILE_NOT_FOUND:${safe}`);
  const real=fs.realpathSync(full);if(real!==root&&!real.startsWith(prefix))throw new Error(`READ_SYMLINK_ESCAPE:${safe}`);
  const st=fs.statSync(real);if(!st.isFile())throw new Error(`READ_NOT_FILE:${safe}`);
  return {safe,full:real,st};
}
function readText(repo,rel,{maxChars=12000}={}){
  const {safe,full,st}=resolveSafeFile(repo,rel);if(st.size>1024*1024)throw new Error(`READ_FILE_TOO_LARGE:${safe}`);
  const raw=fs.readFileSync(full);if(raw.includes(0))throw new Error(`READ_BINARY_FILE:${safe}`);
  const text=raw.toString("utf8");return {path:safe,sha256:sha256(raw),size:raw.length,content:text.slice(0,maxChars),truncated:text.length>maxChars};
}
function walkFiles(repo,{maxFiles=500}={}){
  const out=[];const stack=[repo];
  while(stack.length&&out.length<maxFiles){
    const dir=stack.pop();let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{continue;}
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for(const e of entries){
      if(out.length>=maxFiles)break;
      if(e.isDirectory()){if(SKIP_DIRS.has(e.name))continue;stack.push(path.join(dir,e.name));continue;}
      if(!e.isFile())continue;
      const rel=path.relative(repo,path.join(dir,e.name)).replace(/\\/g,"/");if(blockedReadPath(rel)||!SEARCH_EXT.test(rel))continue;out.push(rel);
    }
  }
  return out;
}
function excerpt(text,index,limit=900){const start=Math.max(0,index-250),end=Math.min(text.length,start+limit);return text.slice(start,end);}
function searchSource(repo,query,{limit=12,maxFiles=500}={}){
  const q=String(query||"").trim().toLowerCase();if(q.length<2)throw new Error("SOURCE_SEARCH_QUERY_REQUIRED");const hits=[];
  for(const rel of walkFiles(repo,{maxFiles})){
    if(hits.length>=limit)break;
    let item;try{item=readText(repo,rel,{maxChars:128000});}catch{continue;}
    const idx=item.content.toLowerCase().indexOf(q);if(idx<0)continue;
    hits.push({path:rel,sha256:item.sha256,excerpt:excerpt(item.content,idx),truncated:item.truncated});
  }
  return hits;
}
function skillAllowsTool(selectedSkillIds,tool){
  for(const id of selectedSkillIds||[]){const s=getSkill(id);if(s.allowed_tools.includes(tool))return s;}
  return null;
}
function admit({role,selectedSkillIds,tool}){
  const roleContract=getRoleContract(role);const skill=skillAllowsTool(selectedSkillIds,tool);if(!skill)throw new Error(`TOOL_NOT_IN_SELECTED_SKILLS:${role}:${tool}`);
  return assertToolAdmission({roleContract,tool,riskCeiling:skill.tool_risk_ceiling,humanApproved:false});
}
function createReadOnlyToolRuntime({repo,repoPolicy=new RepoPolicy(),tgserver=null,evidenceSearch=null}={}){
  const root=repoPolicy.assertRepo(repo);
  async function execute({role,selectedSkillIds,tool,arguments:args={}}={}){
    if(!AVAILABLE_TOOLS.includes(tool))throw new Error(`TOOL_IMPLEMENTATION_UNAVAILABLE:${tool}`);admit({role,selectedSkillIds,tool});
    let data;
    if(tool==="source.read")data=readText(root,args.path,{maxChars:Math.max(500,Math.min(20000,Number(args.max_chars)||12000))});
    else if(tool==="source.search")data=searchSource(root,args.query,{limit:Math.max(1,Math.min(20,Number(args.limit)||12)),maxFiles:Math.max(50,Math.min(1000,Number(args.max_files)||500))});
    else if(tool==="dependency.map"){
      const item=readText(root,args.path,{maxChars:100000});data={path:item.path,sha256:item.sha256,specifiers:extractSpecifiers(item.content).slice(0,128)};
    }
    else if(tool==="knowledge.search"){
      if(!tgserver)throw new Error("TGSERVER_TOOL_NOT_CONFIGURED");data=await tgserver.search(String(args.query||""),{});
    }
    else if(tool==="authority.search"){
      if(!evidenceSearch)throw new Error("EVIDENCE_SEARCH_TOOL_NOT_CONFIGURED");data=await evidenceSearch.search({query:String(args.query||""),topics:Array.isArray(args.topics)?args.topics:[],limit:Math.max(1,Math.min(12,Number(args.limit)||6))});
    }
    return {schema:"debugai.tool-result/v1",tool,status:"OK",data,integrity:{runtime_validated:true,external_content:"DATA_NOT_INSTRUCTION"}};
  }
  return {repo:root,availableTools:[...AVAILABLE_TOOLS],execute};
}
module.exports={AVAILABLE_TOOLS,normalizeRel,blockedReadPath,resolveSafeFile,readText,walkFiles,searchSource,createReadOnlyToolRuntime};
