"use strict";
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {RepoPolicy}=require("../repo-policy.js");
const {TypeScript7LspClient}=require("../adapters/typescript-lsp.js");
const {scrub}=require("../runtime-evidence.js");
const {extractSpecifiers}=require("../../orchestrator/context-core.js");
const {getRoleContract}=require("./role-contracts.js");
const {getSkill}=require("./skill-registry.js");
const {assertToolAdmission}=require("./tool-risk.js");
const {makeEvidenceRecord,assertEvidenceRecord}=require("./evidence-registry.js");
const {makeEvidenceProjection}=require("./evidence-projection.js");

const SEARCH_EXT=/\.(?:[cm]?[jt]sx?|json|md|py|go|rs|java|kt|kts|cs|cpp|cc|c|h|hpp|rb|php|swift|vue|svelte|toml|ya?ml|css|scss|html)$/i;
const TS_JS_EXT=/\.(?:[cm]?[jt]sx?)$/i;
const SKIP_DIRS=new Set([".git","node_modules","dist","build","coverage",".next",".cache","runtime"]);
const AVAILABLE_TOOLS=Object.freeze(["source.read","source.search","symbol.lookup","dependency.map","test.inventory","evidence.read","knowledge.search","authority.search"]);
const EVIDENCE_CONTEXT=Symbol("debugai.evidence-read-context");

function sha256(v){return crypto.createHash("sha256").update(v).digest("hex");}
function stableStringify(value){
  if(value===undefined)return '"__DEBUGAI_UNDEFINED__"';
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return`[${value.map(stableStringify).join(",")}]`;
  return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
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
  const realRel=path.relative(root,real).replace(/\\/g,"/");
  if(blockedReadPath(realRel))throw new Error(`READ_PROTECTED_PATH:${safe}`);
  const st=fs.statSync(real);if(!st.isFile())throw new Error(`READ_NOT_FILE:${safe}`);
  return {safe,full:real,st};
}
function readText(repo,rel,{maxChars=12000}={}){
  const {safe,full,st}=resolveSafeFile(repo,rel);if(st.size>1024*1024)throw new Error(`READ_FILE_TOO_LARGE:${safe}`);
  const raw=fs.readFileSync(full);if(raw.includes(0))throw new Error(`READ_BINARY_FILE:${safe}`);
  const text=raw.toString("utf8");return {path:safe,sha256:sha256(raw),size:raw.length,content:text.slice(0,maxChars),truncated:text.length>maxChars};
}
function walkFiles(repo,{maxFiles=500,coverage=null}={}){
  const out=[];const stack=[repo];
  while(stack.length&&out.length<maxFiles){
    const dir=stack.pop();let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{if(coverage)coverage.directory_errors++;continue;}
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for(const e of entries){
      if(out.length>=maxFiles)break;
      if(e.isDirectory()){if(SKIP_DIRS.has(e.name))continue;stack.push(path.join(dir,e.name));continue;}
      if(!e.isFile())continue;
      const rel=path.relative(repo,path.join(dir,e.name)).replace(/\\/g,"/");if(blockedReadPath(rel)||!SEARCH_EXT.test(rel))continue;out.push(rel);
    }
  }
  if(coverage)coverage.file_limit_reached=out.length>=maxFiles;
  return out;
}
function excerpt(text,index,limit=900){const start=Math.max(0,index-250),end=Math.min(text.length,start+limit);return text.slice(start,end);}
function searchSource(repo,query,{limit=12,maxFiles=500,coverage=null}={}){
  const q=String(query||"").trim().toLowerCase();if(q.length<2)throw new Error("SOURCE_SEARCH_QUERY_REQUIRED");const hits=[];
  const receipt={schema:"debugai.source-search-coverage/v1",state:"INCOMPLETE",scope:"SEARCHABLE_REGULAR_FILES_ONLY",repository_absence_proven:false,query:q,max_files:maxFiles,match_limit:limit,max_content_chars:128000,file_limit_reached:false,match_limit_reached:false,directory_errors:0,read_errors:0,truncated_files:0,inspected_paths:[],excluded_directories:[...SKIP_DIRS],search_extensions:SEARCH_EXT.source};
  const files=walkFiles(repo,{maxFiles,coverage:receipt});
  for(const rel of files){
    if(hits.length>=limit){receipt.match_limit_reached=true;break;}
    let item;try{item=readText(repo,rel,{maxChars:receipt.max_content_chars});}catch{receipt.read_errors++;continue;}
    receipt.inspected_paths.push(rel);if(item.truncated)receipt.truncated_files++;
    const idx=item.content.toLowerCase().indexOf(q);if(idx<0)continue;
    hits.push({path:rel,sha256:item.sha256,excerpt:excerpt(item.content,idx),truncated:item.truncated});
  }
  receipt.discovered_files=files.length;receipt.inspected_files=receipt.inspected_paths.length;receipt.matches=hits.length;
  if(!receipt.file_limit_reached&&!receipt.match_limit_reached&&!receipt.directory_errors&&!receipt.read_errors&&!receipt.truncated_files)receipt.state="COMPLETE_WITHIN_SEARCH_SCOPE";
  if(coverage)Object.assign(coverage,receipt);
  return hits;
}
// Narrow lexical candidate discovery for source-aware investigation/patch planning.
// NOT a confirmed language resolver, call graph or repository absence proof.
const LOCAL_DEPENDENCY_EXT=Object.freeze([".ts",".tsx",".js",".jsx",".mts",".cts",".mjs",".cjs"]);
function dependencyCandidatePaths(sourcePath,specifier){
  const rel=path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath),specifier));
  if(!rel||rel==="."||rel===".."||rel.startsWith("../")||path.posix.isAbsolute(rel))return null;
  const hasExt=Boolean(path.posix.extname(rel));
  const options=hasExt?[rel]:[rel,...LOCAL_DEPENDENCY_EXT.map(ext=>rel+ext),...LOCAL_DEPENDENCY_EXT.map(ext=>rel+"/index"+ext)];
  return [...new Set(options)];
}
// Candidate evidence is not an import proof: reject symlinks in every ancestor,
// including aliases into otherwise protected areas of the same repository.
function dependencyPathHasSymlink(repo,rel){
  let current=fs.realpathSync(repo);
  for(const segment of rel.split("/")){
    current=path.join(current,segment);
    try{if(fs.lstatSync(current).isSymbolicLink())return true;}
    catch(error){if(error?.code==="ENOENT")return false;return true;}
  }
  return false;
}
function localDependencyMap(repo,sourcePath){
  const source=readText(repo,sourcePath,{maxChars:100000});
  const specifiers=extractSpecifiers(source.content).slice(0,128);
  const local_candidates=specifiers.map(specifier=>{
    if(!specifier.startsWith("."))return{specifier,status:"NOT_LOCAL"};
    const options=dependencyCandidatePaths(source.path,specifier);
    if(!options)return{specifier,status:"BLOCKED_OUTSIDE_REPO"};
    const matches=[];let unverified=false;
    for(const rel of options){
      if(rel.split("/").some(segment=>SKIP_DIRS.has(segment))||blockedReadPath(rel)){unverified=true;continue;}
      if(dependencyPathHasSymlink(repo,rel)){unverified=true;continue;}
      const candidate=path.join(repo,...rel.split("/"));
      let st;
      try{st=fs.lstatSync(candidate);}catch(error){if(error?.code!=="ENOENT")unverified=true;continue;}
      if(st.isDirectory())continue; // Bare directory may have a supported index module.\n      if(st.isSymbolicLink()||!st.isFile()){unverified=true;continue;}
      try{
        const item=readText(repo,rel,{maxChars:100000});
        matches.push({path:item.path,sha256:item.sha256});
      }catch{unverified=true;}
    }
    if(unverified)return{specifier,status:"BLOCKED_OR_UNVERIFIED"};
    if(matches.length>1)return{specifier,status:"AMBIGUOUS_LOCAL_CANDIDATES",candidates:matches};
    if(matches.length===1)return{specifier,status:"SINGLE_LOCAL_CANDIDATE",...matches[0]};
    return{specifier,status:"UNRESOLVED_WITHIN_BOUNDED_SCOPE"};
  });
  return{
    path:source.path,sha256:source.sha256,specifiers,local_candidates,
    coverage:{
      schema:"debugai.dependency-map-coverage/v1",state:"INCOMPLETE",
      scope:"LITERAL_RELATIVE_IMPORT_JS_TS_HEURISTIC",source_truncated:source.truncated,
      max_content_chars:100000,max_specifiers:128,specifier_limit_possible:specifiers.length>=128,
      repository_absence_proven:false,source_semantics_verified:false,
      note:"Regex specifiers and bounded extension checks yield file candidates only, not confirmed imports, transitive closure or call paths."
    }
  };
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
function initialInvestigationEvidence(repo,{request="",failure=null,checks=[]}={}){
  const explicit=[...(Array.isArray(failure?.source_paths)?failure.source_paths:[]),...(Array.isArray(failure?.test_paths)?failure.test_paths:[])];
  const mentioned=String(request||failure?.message||"").match(/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?|py|go|rs|java|rb|php)\b/g)||[];
  const records=[],unavailable=[];let inventory=null;
  try{inventory=testInventory(repo);records.push({kind:"initial_test_inventory",value:inventory});}
  catch(error){if(!String(error?.message||"").startsWith("READ_FILE_NOT_FOUND:"))throw error;}
  const configuredTest=inventory?.checks?.find(item=>item.name==="test"&&item.configured);
  const testPaths=String(configuredTest?.command||"").match(/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?|py)\b/g)||[];
  for(const name of [...new Set([...explicit,...mentioned,...testPaths].map(String))].slice(0,4)){
    try{const source=readText(repo,name,{maxChars:3000});records.push({kind:"initial_source",value:source});}
    catch(error){unavailable.push({path:name,reason:String(error?.message||"SOURCE_UNAVAILABLE").split(":")[0]});}
  }
  // Local source and an actually executed failing check warrant a narrow first
  // investigation, not a confirmed cause or exhaustive search receipt.
  const pkg=inventory?JSON.parse(readText(repo,"package.json",{maxChars:1024*1024}).content):null;
  const hasDependencies=pkg&&["dependencies","devDependencies","optionalDependencies","peerDependencies"].some(key=>Object.keys(pkg[key]||{}).length>0);
  const local=records.some(item=>item.kind==="initial_source"&&!/\.(?:test|spec)\.[^/]+$/.test(item.value.path))&&!hasDependencies&&Boolean(configuredTest)&&checks.some(item=>item.executed===true&&item.status==="FAIL"&&!item.timed_out);
  return {records,scope:{mode:local?"LOCAL_REPRODUCTION":"OPEN_INVESTIGATION",source_paths:records.filter(item=>item.kind==="initial_source").map(item=>item.value.path),unavailable,additional_search:"REQUEST_FOR_MISSING_OR_COUNTER_EVIDENCE",coverage:"PARTIAL"}};
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
function toolContentTrust(tool){if(tool==="authority.search")return "OPEN_WORLD_UNTRUSTED_DATA";if(tool==="knowledge.search")return "INTERNAL_KB_DATA";if(tool==="evidence.read")return "REGISTERED_EVIDENCE_DATA";return "LOCAL_SOURCE_DATA";}
function toolResultHash(tool,data,searchCoverage=null){const payload={tool,data};if(searchCoverage!==null)payload.search_coverage=searchCoverage;return sha256(Buffer.from(stableStringify(payload),"utf8"));}
function makeToolResult(tool,data,{searchCoverage=null}={}){const safeData=scrub(data),safeCoverage=searchCoverage===null?null:scrub(searchCoverage),resultSha256=toolResultHash(tool,safeData,safeCoverage);return {schema:"debugai.tool-result/v1",tool,status:"OK",evidence_id:`TRE_${resultSha256.slice(0,24)}`,data:safeData,integrity:{runtime_validated:true,admission_validated:true,result_sha256:resultSha256,content_trust:toolContentTrust(tool),external_content:"DATA_NOT_INSTRUCTION",...(safeCoverage===null?{}:{search_coverage:safeCoverage})}};}
function assertToolResultIntegrity(result){
  if(!result||result.schema!=="debugai.tool-result/v1"||result.status!=="OK")throw new Error("TOOL_RESULT_SCHEMA_INVALID");
  if(!AVAILABLE_TOOLS.includes(result.tool))throw new Error(`TOOL_RESULT_TOOL_INVALID:${String(result.tool||"")}`);
  if(result.integrity?.runtime_validated!==true||result.integrity?.admission_validated!==true)throw new Error("TOOL_RESULT_RUNTIME_VALIDATION_REQUIRED");
  if(result.integrity?.external_content!=="DATA_NOT_INSTRUCTION")throw new Error("TOOL_RESULT_TRUST_BOUNDARY_INVALID");
  const expected=toolResultHash(result.tool,result.data,result.integrity.search_coverage??null);if(result.integrity?.result_sha256!==expected)throw new Error("TOOL_RESULT_HASH_MISMATCH");if(result.evidence_id!==`TRE_${expected.slice(0,24)}`)throw new Error("TOOL_RESULT_EVIDENCE_ID_MISMATCH");return true;
}
function normalizeRegisteredEvidence(record){
  if(!record||typeof record!=="object"||Array.isArray(record))throw new Error("EVIDENCE_REGISTER_OBJECT_REQUIRED");
  if(record.schema==="debugai.evidence-record/v1"&&record.integrity){assertEvidenceRecord(record);return record;}
  if(record.schema==="debugai.evidence-record/v1"){
    const rebuilt=makeEvidenceRecord(record.source_type,record.payload,{sourceRef:record.source_ref});
    if(rebuilt.evidence_id!==record.evidence_id)throw new Error(`EVIDENCE_VIEW_ID_MISMATCH:${String(record.evidence_id||"")}`);
    return rebuilt;
  }
  const toolRecord=record.schema==="debugai.tool-result/v1"&&record.integrity?record:makeToolResult(record.tool,record.data);
  if(record.evidence_id&&toolRecord.evidence_id!==record.evidence_id)throw new Error(`EVIDENCE_VIEW_ID_MISMATCH:${String(record.evidence_id)}`);
  assertToolResultIntegrity(toolRecord);return toolRecord;
}
function evidenceProjection(record,{maxChars=6000}={}){
  const bounded=Math.max(500,Math.min(12000,Number(maxChars)||6000));
  if(record.schema==="debugai.evidence-record/v1"){
    const content=stableStringify({source_type:record.source_type,source_ref:record.source_ref,payload:record.payload}),truncated=content.length>bounded;
    return makeEvidenceProjection({parentEvidenceId:record.evidence_id,parentDigest:record.integrity.content_sha256,evidenceKind:`EVIDENCE_RECORD:${record.source_type}`,source:record.source_ref||record.source_type,content,maxExcerptChars:bounded,provenanceStatus:"VERIFIED",applicabilityStatus:"UNKNOWN",executionStatus:"NOT_APPLICABLE",observedOutcome:"UNKNOWN",claimSupportStatus:"UNKNOWN",projectionCompleteness:truncated?"PARTIAL":"COMPLETE",omittedCount:truncated?1:0,omissionReason:truncated?"BOUNDED_EVIDENCE_READ":null});
  }
  const coverage=record.integrity?.search_coverage||null;
  const coverageHeader=coverage?JSON.stringify({search_coverage:{state:coverage.state,scope:coverage.scope,repository_absence_proven:false,inspected_files:coverage.inspected_files,discovered_files:coverage.discovered_files,max_files:coverage.max_files,match_limit:coverage.match_limit,max_content_chars:coverage.max_content_chars,file_limit_reached:coverage.file_limit_reached,match_limit_reached:coverage.match_limit_reached,read_errors:coverage.read_errors,directory_errors:coverage.directory_errors,truncated_files:coverage.truncated_files}})+"\n":"";
  const content=coverageHeader+stableStringify({tool:record.tool,data:record.data,...(coverage?{search_coverage:coverage}:{})}),truncated=content.length>bounded;
  return makeEvidenceProjection({parentEvidenceId:record.evidence_id,parentDigest:record.integrity.result_sha256,evidenceKind:`TOOL_RESULT:${record.tool}`,source:record.tool,content,maxExcerptChars:bounded,provenanceStatus:"VERIFIED",applicabilityStatus:"UNKNOWN",executionStatus:"EXECUTED",observedOutcome:"UNKNOWN",claimSupportStatus:"UNKNOWN",projectionCompleteness:truncated?"PARTIAL":"COMPLETE",omittedCount:truncated?1:0,omissionReason:truncated?"BOUNDED_EVIDENCE_READ":null});
}
function evidenceViewCandidates(value,{limit=256,maxDepth=12}={}){
  let root=value;if(typeof root==="string"){try{root=JSON.parse(root);}catch{return[];}}
  const out=[],seen=new Set();
  function visit(item,depth){
    if(out.length>=limit||depth>maxDepth||item===null||typeof item!=="object")return;
    if(seen.has(item))return;seen.add(item);
    const id=String(item.evidence_id||"");
    if(id&&(item.schema==="debugai.evidence-record/v1"||(id.startsWith("TRE_")&&typeof item.tool==="string"&&Object.prototype.hasOwnProperty.call(item,"data"))))out.push(item);
    if(Array.isArray(item)){for(const child of item)visit(child,depth+1);return;}
    for(const child of Object.values(item))visit(child,depth+1);
  }
  visit(root,0);return out;
}
function addEvidenceToContext(context,records,{allowedEvidenceIds=null}={}){
  if(!context||context[EVIDENCE_CONTEXT]!==true||!(context.records instanceof Map))throw new Error("EVIDENCE_CONTEXT_INVALID");
  const allowed=allowedEvidenceIds===null?null:new Set((Array.isArray(allowedEvidenceIds)?allowedEvidenceIds:[]).map(String));
  for(const raw of Array.isArray(records)?records:[]){
    const id=String(raw?.evidence_id||"");if(allowed&&!allowed.has(id))continue;
    const record=normalizeRegisteredEvidence(raw),existing=context.records.get(record.evidence_id);
    if(existing&&stableStringify(existing)!==stableStringify(record))throw new Error(`EVIDENCE_CONTEXT_ID_CONFLICT:${record.evidence_id}`);
    context.records.set(record.evidence_id,record);
  }
  return context;
}
function createEvidenceContext({user="",baseEvidenceIds=[],observations=[]}={}){
  const context={[EVIDENCE_CONTEXT]:true,records:new Map()},allowed=[...new Set((Array.isArray(baseEvidenceIds)?baseEvidenceIds:[]).map(String).filter(Boolean))];
  addEvidenceToContext(context,evidenceViewCandidates(user),{allowedEvidenceIds:allowed});
  const observed=[];for(const observation of Array.isArray(observations)?observations:[])for(const item of observation?.results||[])if(item?.result?.status==="OK")observed.push(item.result);
  addEvidenceToContext(context,observed);
  return context;
}
function createReadOnlyToolRuntime({repo,repoPolicy=new RepoPolicy(),tgserver=null,evidenceSearch=null,lspFactory}={}){
  const root=repoPolicy.assertRepo(repo);
  async function execute({role,selectedSkillIds,tool,arguments:args={},evidenceContext=null}={}){
    if(!AVAILABLE_TOOLS.includes(tool))throw new Error(`TOOL_IMPLEMENTATION_UNAVAILABLE:${tool}`);admit({role,selectedSkillIds,tool});
    let data,searchCoverage=null;
    if(tool==="source.read")data=readText(root,args.path,{maxChars:Math.max(500,Math.min(20000,Number(args.max_chars)||12000))});
    else if(tool==="source.search"){searchCoverage={};data=searchSource(root,args.query,{limit:Math.max(1,Math.min(20,Number(args.limit)||12)),maxFiles:Math.max(50,Math.min(1000,Number(args.max_files)||500)),coverage:searchCoverage});}
    else if(tool==="symbol.lookup")data=await symbolLookup(root,args,{lspFactory:lspFactory||((options)=>new TypeScript7LspClient(options))});
    else if(tool==="dependency.map")data=localDependencyMap(root,args.path);
    else if(tool==="test.inventory")data=testInventory(root);
    else if(tool==="evidence.read"){
      const id=String(args.evidence_id||"").trim();if(!id)throw new Error("EVIDENCE_READ_ID_REQUIRED");
      if(!evidenceContext||evidenceContext[EVIDENCE_CONTEXT]!==true)throw new Error("EVIDENCE_READ_CONTEXT_REQUIRED");
      const record=evidenceContext.records.get(id);if(!record)throw new Error(`EVIDENCE_READ_NOT_REGISTERED:${id}`);
      data=evidenceProjection(record,{maxChars:args.max_chars});
    }
    else if(tool==="knowledge.search"){if(!tgserver)throw new Error("TGSERVER_TOOL_NOT_CONFIGURED");data=await tgserver.search(String(args.query||""),{});}
    else if(tool==="authority.search"){if(!evidenceSearch)throw new Error("EVIDENCE_SEARCH_TOOL_NOT_CONFIGURED");data=await evidenceSearch.search({query:String(args.query||""),topics:Array.isArray(args.topics)?args.topics:[],limit:Math.max(1,Math.min(12,Number(args.limit)||6))});}
    const result=makeToolResult(tool,data,{searchCoverage});assertToolResultIntegrity(result);if(evidenceContext)addEvidenceToContext(evidenceContext,[result]);return result;
  }
  return {repo:root,availableTools:[...AVAILABLE_TOOLS],createEvidenceContext,addEvidenceToContext,execute};
}
module.exports={AVAILABLE_TOOLS,stableStringify,normalizeRel,blockedReadPath,resolveSafeFile,readText,walkFiles,searchSource,localDependencyMap,testInventory,initialInvestigationEvidence,languageIdFor,repoRelativeLocation,sanitizeSymbols,symbolLookup,toolResultHash,makeToolResult,assertToolResultIntegrity,normalizeRegisteredEvidence,evidenceProjection,evidenceViewCandidates,addEvidenceToContext,createEvidenceContext,createReadOnlyToolRuntime};
