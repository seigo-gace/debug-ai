"use strict";
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {RepoPolicy}=require("../repo-policy.js");
const {TypeScript7LspClient}=require("../adapters/typescript-lsp.js");
const {extractSpecifiers}=require("../../orchestrator/context-core.js");
const {getRoleContract}=require("./role-contracts.js");
const {getSkill}=require("./skill-registry.js");
const {assertToolAdmission}=require("./tool-risk.js");

const SEARCH_EXT=/\.(?:[cm]?[jt]sx?|json|md|py|go|rs|java|kt|kts|cs|cpp|cc|c|h|hpp|rb|php|swift|vue|svelte|toml|ya?ml|css|scss|html)$/i;
const TS_JS_EXT=/\.(?:[cm]?[jt]sx?)$/i;
const SKIP_DIRS=new Set([".git","node_modules","dist","build","coverage",".next",".cache","runtime"]);
const AVAILABLE_TOOLS=Object.freeze(["source.read","source.search","symbol.lookup","dependency.map","test.inventory","knowledge.search","authority.search"]);

function sha256(v){return crypto.createHash("sha256").update(v).digest("hex");}
function stableStringify(value){
  if(value===undefined)return '"__DEBUGAI_UNDEFINED__"';
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
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
function testInventory(repo){
  const item=readText(repo,"package.json",{maxChars:1024*1024});let pkg;
  try{pkg=JSON.parse(item.content);}catch{throw new Error("TEST_INVENTORY_PACKAGE_JSON_INVALID");}
  const scripts=pkg?.scripts&&typeof pkg.scripts==="object"&&!Array.isArray(pkg.scripts)?pkg.scripts:{};
  let packageManager="npm";
  const declared=String(pkg?.packageManager||"").trim();
  if(/^(npm|pnpm|yarn|bun)(?:@|$)/i.test(declared))packageManager=declared.match(/^(npm|pnpm|yarn|bun)/i)[1].toLowerCase();
  else if(fs.existsSync(path.join(repo,"pnpm-lock.yaml")))packageManager="pnpm";
  else if(fs.existsSync(path.join(repo,"yarn.lock")))packageManager="yarn";
  else if(fs.existsSync(path.join(repo,"bun.lock"))||fs.existsSync(path.join(repo,"bun.lockb")))packageManager="bun";
  const checks=["lint","typecheck","test","build"].map(name=>({name,configured:typeof scripts[name]==="string"&&scripts[name].trim().length>0,command:typeof scripts[name]==="string"?scripts[name].slice(0,1000):null}));
  return{package_json:{path:item.path,sha256:item.sha256},package_manager:packageManager,checks};
}
function languageIdFor(rel){
  const low=String(rel).toLowerCase();
  if(low.endsWith(".tsx"))return "typescriptreact";
  if(low.endsWith(".ts")||low.endsWith(".mts")||low.endsWith(".cts"))return "typescript";
  if(low.endsWith(".jsx"))return "javascriptreact";
  return "javascript";
}
function repoRelativeLocation(root,item){
  const candidate=item?.path;if(!candidate)return null;
  let real;try{real=fs.realpathSync(candidate);}catch{return null;}
  const rel=path.relative(root,real);
  if(!rel||rel.startsWith("..")||path.isAbsolute(rel))return null;
  const normalized=rel.replace(/\\/g,"/");
  if(normalized.split("/").some(part=>SKIP_DIRS.has(part))||blockedReadPath(normalized))return null;
  return {path:normalized,range:item.range||null};
}
function sanitizeSymbols(items,limit=128){
  const out=[];
  const visit=(list,depth=0)=>{
    if(!Array.isArray(list)||depth>8)return;
    for(const item of list){
      if(out.length>=limit)return;
      if(!item||typeof item!=="object")continue;
      out.push({name:String(item.name||"").slice(0,300),kind:Number.isInteger(item.kind)?item.kind:null,range:item.range||null,selectionRange:item.selectionRange||null});
      visit(item.children,depth+1);
    }
  };
  visit(items);return out;
}
async function symbolLookup(root,args,{lspFactory=(options)=>new TypeScript7LspClient(options)}={}){
  const mode=String(args?.mode||"definition");
  if(!["definition","references","document_symbols"].includes(mode))throw new Error(`SYMBOL_MODE_INVALID:${mode}`);
  const item=resolveSafeFile(root,args?.path);
  if(!TS_JS_EXT.test(item.safe))throw new Error(`SYMBOL_LANGUAGE_UNSUPPORTED:${item.safe}`);
  const symbol=String(args?.symbol||"").trim();
  if(mode!=="document_symbols"&&!symbol)throw new Error("SYMBOL_NAME_REQUIRED");
  const client=lspFactory({rootDir:root,timeoutMs:15000});
  if(!client||typeof client.start!=="function"||typeof client.stop!=="function")throw new Error("SYMBOL_LSP_FACTORY_INVALID");
  try{
    await client.start();
    if(typeof client.open==="function")client.open(item.full,languageIdFor(item.safe));
    if(mode==="document_symbols"){
      const symbols=await client.documentSymbols(item.full);
      return {path:item.safe,mode,symbols:sanitizeSymbols(symbols)};
    }
    const locations=mode==="definition"?await client.definition(item.full,symbol):await client.references(item.full,symbol);
    const normalized=[];let outsideRepoOmitted=0;
    for(const location of Array.isArray(locations)?locations:[]){const safe=repoRelativeLocation(root,location);if(safe)normalized.push(safe);else outsideRepoOmitted++;}
    return {path:item.safe,mode,symbol:symbol.slice(0,300),locations:normalized.slice(0,128),outside_repo_omitted:outsideRepoOmitted};
  }finally{await client.stop();}
}
function skillAllowsTool(selectedSkillIds,tool){for(const id of selectedSkillIds||[]){const s=getSkill(id);if(s.allowed_tools.includes(tool))return s;}return null;}
function admit({role,selectedSkillIds,tool}){const roleContract=getRoleContract(role);const skill=skillAllowsTool(selectedSkillIds,tool);if(!skill)throw new Error(`TOOL_NOT_IN_SELECTED_SKILLS:${role}:${tool}`);return assertToolAdmission({roleContract,tool,riskCeiling:skill.tool_risk_ceiling,humanApproved:false});}
function toolContentTrust(tool){if(tool==="authority.search")return "OPEN_WORLD_UNTRUSTED_DATA";if(tool==="knowledge.search")return "INTERNAL_KB_DATA";return "LOCAL_SOURCE_DATA";}
function toolResultHash(tool,data){return sha256(Buffer.from(stableStringify({tool,data}),"utf8"));}
function makeToolResult(tool,data){const resultSha256=toolResultHash(tool,data);return {schema:"debugai.tool-result/v1",tool,status:"OK",evidence_id:`TRE_${resultSha256.slice(0,24)}`,data,integrity:{runtime_validated:true,admission_validated:true,result_sha256:resultSha256,content_trust:toolContentTrust(tool),external_content:"DATA_NOT_INSTRUCTION"}};}
function assertToolResultIntegrity(result){
  if(!result||result.schema!=="debugai.tool-result/v1"||result.status!=="OK")throw new Error("TOOL_RESULT_SCHEMA_INVALID");
  if(!AVAILABLE_TOOLS.includes(result.tool))throw new Error(`TOOL_RESULT_TOOL_INVALID:${String(result.tool||"")}`);
  if(result.integrity?.runtime_validated!==true||result.integrity?.admission_validated!==true)throw new Error("TOOL_RESULT_RUNTIME_VALIDATION_REQUIRED");
  if(result.integrity?.external_content!=="DATA_NOT_INSTRUCTION")throw new Error("TOOL_RESULT_TRUST_BOUNDARY_INVALID");
  const expected=toolResultHash(result.tool,result.data);if(result.integrity?.result_sha256!==expected)throw new Error("TOOL_RESULT_HASH_MISMATCH");if(result.evidence_id!==`TRE_${expected.slice(0,24)}`)throw new Error("TOOL_RESULT_EVIDENCE_ID_MISMATCH");return true;
}
function createReadOnlyToolRuntime({repo,repoPolicy=new RepoPolicy(),tgserver=null,evidenceSearch=null,lspFactory}={}){
  const root=repoPolicy.assertRepo(repo);
  async function execute({role,selectedSkillIds,tool,arguments:args={}}={}){
    if(!AVAILABLE_TOOLS.includes(tool))throw new Error(`TOOL_IMPLEMENTATION_UNAVAILABLE:${tool}`);admit({role,selectedSkillIds,tool});
    let data;
    if(tool==="source.read")data=readText(root,args.path,{maxChars:Math.max(500,Math.min(20000,Number(args.max_chars)||12000))});
    else if(tool==="source.search")data=searchSource(root,args.query,{limit:Math.max(1,Math.min(20,Number(args.limit)||12)),maxFiles:Math.max(50,Math.min(1000,Number(args.max_files)||500))});
    else if(tool==="symbol.lookup")data=await symbolLookup(root,args,{lspFactory:lspFactory||((options)=>new TypeScript7LspClient(options))});
    else if(tool==="dependency.map"){const item=readText(root,args.path,{maxChars:100000});data={path:item.path,sha256:item.sha256,specifiers:extractSpecifiers(item.content).slice(0,128)};}
    else if(tool==="test.inventory")data=testInventory(root);
    else if(tool==="knowledge.search"){if(!tgserver)throw new Error("TGSERVER_TOOL_NOT_CONFIGURED");data=await tgserver.search(String(args.query||""),{});}
    else if(tool==="authority.search"){if(!evidenceSearch)throw new Error("EVIDENCE_SEARCH_TOOL_NOT_CONFIGURED");data=await evidenceSearch.search({query:String(args.query||""),topics:Array.isArray(args.topics)?args.topics:[],limit:Math.max(1,Math.min(12,Number(args.limit)||6))});}
    const result=makeToolResult(tool,data);assertToolResultIntegrity(result);return result;
  }
  return {repo:root,availableTools:[...AVAILABLE_TOOLS],execute};
}
module.exports={AVAILABLE_TOOLS,stableStringify,normalizeRel,blockedReadPath,resolveSafeFile,readText,walkFiles,searchSource,testInventory,languageIdFor,repoRelativeLocation,sanitizeSymbols,symbolLookup,toolResultHash,makeToolResult,assertToolResultIntegrity,createReadOnlyToolRuntime};
