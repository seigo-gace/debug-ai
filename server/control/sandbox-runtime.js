"use strict";
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const crypto=require("node:crypto");
const {packageManager}=require("../../orchestrator/verify-core.js");

const ACTIONS=new Set(["node.check","package.lint","package.typecheck","package.test","package.build"]);
const SCRIPT_BY_ACTION=Object.freeze({"package.lint":"lint","package.typecheck":"typecheck","package.test":"test","package.build":"build"});
const SKIP_DIRS=new Set([".git","node_modules","dist","build","coverage",".next",".cache","runtime","secrets"]);
const JOB_DIR_RE=/^(?:JOB|DAP)_[a-f0-9]{24}$/;
const PENDING_JOB_DIR_RE=/^\.pending-(?:JOB|DAP)_[a-f0-9]{24}$/;
const SIGNAL_READY_FILE=".debugai-signal-supervisor.ready";
const SIGNAL_SLEEP=new Int32Array(new SharedArrayBuffer(4));
function protectedRel(rel){const low=String(rel||"").replace(/\\/g,"/").toLowerCase();return low===".env"||/(^|\/)\.env($|\.)/.test(low)||/(^|\/)(secrets)(\/|$)/.test(low)||/\.(pem|key|p12|pfx)$/.test(low);}
function safeRel(value){const rel=String(value||"").replace(/\\/g,"/").replace(/^\.\//,"");if(!rel||path.posix.isAbsolute(rel)||/^[A-Za-z]:\//.test(rel)||rel.split("/").includes("..")||protectedRel(rel))throw new Error(`SANDBOX_PATH_INVALID:${rel||"<empty>"}`);return rel;}
function snapshotHash(value){return crypto.createHash("sha256").update(value).digest("hex");}
function freezeSnapshot(value){if(value&&typeof value==="object"){for(const child of Object.values(value))freezeSnapshot(child);Object.freeze(value);}return value;}
function snapshotPath(value){
  if(typeof value!=="string"||value.includes("\\")||value.split("/").some(p=>!p||p==="."||p===".."))throw new Error("SANDBOX_PATH_INVALID");
  return safeRel(value);
}
// Inventory never follows links or reads protected/excluded contents. Exclusions
// are obligations still unproven, not evidence of whole-repository completeness.
function snapshotInventory(source,{maxFiles=8000,maxBytes=256*1024*1024,requiredPaths=[]}={}){
  if(!Number.isSafeInteger(maxFiles)||maxFiles<1||!Number.isSafeInteger(maxBytes)||maxBytes<0||!Array.isArray(requiredPaths))throw new Error("SANDBOX_SNAPSHOT_POLICY_INVALID");
  const root=fs.realpathSync(source),entries=[],exclusions=[];let files=0,bytes=0,count=0;
  const required=[...new Set(requiredPaths.map(snapshotPath))].sort();
  function walk(dir,base=""){
    if(fs.realpathSync(dir)!==dir)throw new Error("SANDBOX_SNAPSHOT_DIRECTORY_CHANGED");
    for(const name of fs.readdirSync(dir).sort()){
      const rel=base?`${base}/${name}`:name;
      if(++count>maxFiles)throw new Error(`SANDBOX_SNAPSHOT_FILE_LIMIT:${count}`);
      // POSIX filenames that alias normalized paths are unsupported as well.
      if(name.includes("\\"))throw new Error("SANDBOX_PATH_INVALID");
      const full=path.join(dir,name),stat=fs.lstatSync(full),type=stat.isSymbolicLink()?"symlink":stat.isDirectory()?"directory":stat.isFile()?"file":"special";
      const reason=protectedRel(rel)?"PROTECTED":name===".git"||SKIP_DIRS.has(name)&&type==="directory"?"POLICY_EXCLUDED":type==="symlink"?"SYMLINK_UNSUPPORTED":type==="special"?"TYPE_UNSUPPORTED":null;
      if(reason){exclusions.push({path:rel,type,reason,...(type==="symlink"?{target_sha256:snapshotHash(fs.readlinkSync(full))}:{})});continue;}
      const executable_mode=stat.mode&0o111;
      if(type==="directory"){entries.push({path:rel,type,executable_mode});walk(full,rel);continue;}
      if(bytes+stat.size>maxBytes)throw new Error(`SANDBOX_SNAPSHOT_BYTE_LIMIT:${bytes+stat.size}`);
      const fd=fs.openSync(full,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      let data;try{const current=fs.fstatSync(fd);if(!current.isFile()||current.dev!==stat.dev||current.ino!==stat.ino)throw new Error("SANDBOX_SNAPSHOT_FILE_CHANGED");data=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
      files++;bytes+=data.length;if(bytes>maxBytes)throw new Error(`SANDBOX_SNAPSHOT_BYTE_LIMIT:${bytes}`);
      entries.push({path:rel,type,executable_mode,bytes:data.length,sha256:snapshotHash(data)});
    }
  }
  walk(root);entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);exclusions.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  for(const rel of required)if(!entries.some(e=>e.path===rel&&e.type==="file"))throw new Error(`SANDBOX_SNAPSHOT_INCOMPLETE:${rel}`);
  const body={schema:"debugai.sandbox-snapshot/v1",entries,exclusions,entry_count:entries.length,files,bytes,required_paths:required,limits:{maxFiles,maxBytes},symlink_policy:"EXCLUDE_NO_DEREFERENCE",required_status:required.length?"PRESENT":"NOT_VERIFIED",completeness:"NOT_VERIFIED",construction:"NOT_CONFIGURED"};
  return freezeSnapshot({...body,digest:snapshotHash(JSON.stringify(body))});
}
function assertSnapshotManifest(manifest){
  if(!manifest||manifest.schema!=="debugai.sandbox-snapshot/v1"||manifest.completeness!=="NOT_VERIFIED"||manifest.construction!=="NOT_CONFIGURED")throw new Error("SANDBOX_SNAPSHOT_MANIFEST_INVALID");
  const {digest,...body}=manifest;if(digest!==snapshotHash(JSON.stringify(body)))throw new Error("SANDBOX_SNAPSHOT_MANIFEST_INVALID");
  return manifest;
}
function verifySnapshotCopy(destination,manifest,{provisioned=false}={}){
  assertSnapshotManifest(manifest);
  const observed=snapshotInventory(destination,{...manifest.limits,requiredPaths:manifest.required_paths});
  // Only the existing exact-source package-test provisioner can add these two
  // top-level artifacts. Its dependency/native provenance checks remain owners.
  const unexpected=observed.exclusions.filter(e=>!(provisioned&&["node_modules","build"].includes(e.path)));
  if(unexpected.length||JSON.stringify(observed.entries)!==JSON.stringify(manifest.entries))throw new Error("SANDBOX_SNAPSHOT_COPY_MISMATCH");
  return {status:"MATERIALIZED_ENTRIES_MATCH",manifest_digest:manifest.digest,completeness:"NOT_VERIFIED",construction:"NOT_CONFIGURED"};
}
function copySnapshot(source,destination,options={}){
  const root=fs.realpathSync(source),dst=path.resolve(destination);
  // Never modify a caller's existing tree or copy recursively into the source.
  if(fs.existsSync(dst)||dst===root||dst.startsWith(root+path.sep)||root.startsWith(dst+path.sep))throw new Error("SANDBOX_SNAPSHOT_DESTINATION_INVALID");
  let ancestor=path.dirname(dst);
  while(!fs.existsSync(ancestor)){const up=path.dirname(ancestor);if(up===ancestor)throw new Error("SANDBOX_SNAPSHOT_DESTINATION_INVALID");ancestor=up;}
  if(fs.realpathSync(ancestor)!==ancestor)throw new Error("SANDBOX_SNAPSHOT_DESTINATION_INVALID");
  fs.mkdirSync(path.dirname(dst),{recursive:true});
  const parent=fs.realpathSync(path.dirname(dst));if(parent!==path.dirname(dst)||parent===root||parent.startsWith(root+path.sep))throw new Error("SANDBOX_SNAPSHOT_DESTINATION_INVALID");
  const manifest=snapshotInventory(root,options);fs.mkdirSync(dst);
  try{
    for(const entry of manifest.entries){
      const from=path.join(root,entry.path),to=path.join(dst,entry.path);
      if(entry.type==="directory"){fs.mkdirSync(to,{recursive:true,mode:0o600|entry.executable_mode});continue;}
      if(fs.realpathSync(path.dirname(from))!==path.dirname(from))throw new Error("SANDBOX_SNAPSHOT_DIRECTORY_CHANGED");
      const fd=fs.openSync(from,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let data;
      try{if(!fs.fstatSync(fd).isFile())throw new Error("SANDBOX_SNAPSHOT_FILE_CHANGED");data=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
      if(data.length!==entry.bytes||snapshotHash(data)!==entry.sha256||(fs.lstatSync(from).mode&0o111)!==entry.executable_mode)throw new Error("SANDBOX_SNAPSHOT_SOURCE_CHANGED");
      fs.writeFileSync(to,data,{flag:"wx",mode:0o600|entry.executable_mode});
    }
    if(snapshotInventory(root,options).digest!==manifest.digest)throw new Error("SANDBOX_SNAPSHOT_SOURCE_CHANGED");
    verifySnapshotCopy(dst,manifest);
    return {files:manifest.files,bytes:manifest.bytes,skipped_symlinks:manifest.exclusions.filter(e=>e.type==="symlink").length,manifest};
  }catch(error){fs.rmSync(dst,{recursive:true,force:true});throw error;}
}
// Construct a bounded candidate INSIDE the copied job snapshot only; never touch sourceRepo.
// A manifest proves staging identity, not semantic correctness, apply permission, or tree completeness.
const CANDIDATE_ACTIONS=new Set(["create","replace","delete"]);
function candidateScopePath(value){
  const rel=snapshotPath(value);
  if(rel.split("/").some(x=>SKIP_DIRS.has(x)||x===".git")||protectedRel(rel))throw new Error("SANDBOX_CANDIDATE_PATH_FORBIDDEN");
  return rel;
}
function snapshotDelta(baseline,candidate){
  const before=new Map(baseline.entries.filter(x=>x.type==="file").map(x=>[x.path,x]));
  const after=new Map(candidate.entries.filter(x=>x.type==="file").map(x=>[x.path,x]));
  const out=[];
  for(const p of [...new Set([...before.keys(),...after.keys()])].sort()){
    const a=before.get(p),b=after.get(p);
    if(!a&&!b)continue;
    if(a&&b&&a.sha256===b.sha256&&a.executable_mode===b.executable_mode)continue;
    out.push({path:p,type:!a?"create":!b?"delete":"replace",before_sha256:a?.sha256||null,after_sha256:b?.sha256||null});
  }
  return out;
}
function assertPatchCandidateRef(ref){
 if(!ref||typeof ref!=="object"||Array.isArray(ref)||!/^patch_[a-f0-9]{24}$/.test(ref.id)||!^([a-f0-9]{64})$/.test(ref.candidate_hash)||ref.id!=="patch_"+ref.candidate_hash.slice(0,24))throw new Error("SANDBOX_CANDIDATE_PATCH_REF_INVALID");
 return ref;
}
function verifyCandidateSnapshot(repo,request){
  const b=request?.source_snapshot?.manifest,c=request?.candidate_snapshot;
  if(!c||c.construction!=="MATERIALIZED_VERIFIED"||!b||!c.manifest||!Array.isArray(c.changed_paths)||!c.changed_paths.length)throw new Error("SANDBOX_CANDIDATE_REQUEST_INVALID");
  assertSnapshotManifest(b);assertSnapshotManifest(c.manifest);
  const declared=c.patch_candidate_ref||null,origin=request.patch_candidate_origin||null;
  if(Boolean(declared)!==Boolean(origin))throw new Error("SANDBOX_CANDIDATE_ORIGIN_MISSING");
  if(declared){
    assertPatchCandidateRef(declared);assertPatchCandidateRef(origin);
    if(JSON.stringify(declared)!==JSON.stringify(origin))throw new Error("SANDBOX_CANDIDATE_ORIGIN_MISMATCH");
  }
  const expected=snapshotHash(JSON.stringify({baseline_digest:b.digest,candidate_digest:c.manifest.digest,changed_paths:c.changed_paths,...(declared?{patch_candidate_ref:declared}:{})}));
  if(c.digest!==expected)throw new Error("SANDBOX_CANDIDATE_BINDING_INVALID");
  if(c.manifest.digest===b.digest)throw new Error("SANDBOX_CANDIDATE_NO_DELTA");
  const before=new Map(b.entries.map(e=>[e.path,e]));
  const after=new Map(c.manifest.entries.map(e=>[e.path,e]));
  for(const [rel,entry] of before){if(entry.type==="directory"&&JSON.stringify(after.get(rel))!==JSON.stringify(entry))throw new Error("SANDBOX_CANDIDATE_DIRECTORY_CHANGED");}
  if(c.manifest.exclusions.length)throw new Error("SANDBOX_CANDIDATE_EXCLUSION_INVALID");
  if(JSON.stringify(snapshotDelta(b,c.manifest))!==JSON.stringify(c.changed_paths))throw new Error("SANDBOX_CANDIDATE_DELTA_INVALID");
  if(c.changed_paths.some(x=>!CANDIDATE_ACTIONS.has(x.type)||candidateScopePath(x.path)!==x.path))throw new Error("SANDBOX_CANDIDATE_SCOPE_INVALID");
  verifySnapshotCopy(repo,c.manifest);
  return "CANDIDATE_EXACT_MATCH";
}
function stageSandboxCandidate(snapshot,baseline,candidate){
  if(!candidate||typeof candidate!=="object"||Array.isArray(candidate)||!Array.isArray(candidate.operations)||candidate.operations.length<1||candidate.operations.length>16)throw new Error("SANDBOX_CANDIDATE_CONTRACT_INVALID");
  const seen=new Set();let total=0;
  const before=new Map(baseline.entries.map(e=>[e.path,e]));
  const staged=[];
  for(const item of candidate.operations){
    if(!item||typeof item!=="object"||!CANDIDATE_ACTIONS.has(item.type))throw new Error("SANDBOX_CANDIDATE_OPERATION_INVALID");
    const rel=candidateScopePath(item.path);
    if(seen.has(rel))throw new Error("SANDBOX_CANDIDATE_DUPLICATE_PATH");seen.add(rel);
    const prior=before.get(rel),parent=path.posix.dirname(rel);
    if(parent!=="."&&before.get(parent)?.type!=="directory")throw new Error("SANDBOX_CANDIDATE_PARENT_MISSING");
    if(item.type==="create"){
      if(prior||Object.prototype.hasOwnProperty.call(item,"expected_sha256"))throw new Error("SANDBOX_CANDIDATE_CREATE_EXISTS");
    }else{
      if(!prior||prior.type!=="file"||typeof item.expected_sha256!=="string"||item.expected_sha256!==prior.sha256)throw new Error("SANDBOX_CANDIDATE_STALE_BASELINE");
    }
    if(item.type==="delete"){
      if(Object.prototype.hasOwnProperty.call(item,"content_utf8"))throw new Error("SANDBOX_CANDIDATE_DELETE_PAYLOAD");
    }else{
      if(typeof item.content_utf8!=="string")throw new Error("SANDBOX_CANDIDATE_CONTENT_INVALID");
      const bytes=Buffer.byteLength(item.content_utf8,"utf8");total+=bytes;
      if(bytes>256*1024||total>512*1024)throw new Error("SANDBOX_CANDIDATE_BYTE_LIMIT");
    }
    staged.push({type:item.type,path:rel,content:item.content_utf8});
  }
  for(const item of staged){
    const target=path.join(snapshot,...item.path.split("/"));
    const parent=path.dirname(target);
    if(fs.realpathSync(parent)!==parent||fs.lstatSync(parent).isSymbolicLink())throw new Error("SANDBOX_CANDIDATE_DIRECTORY_UNSAFE");
    if(item.type==="delete")fs.unlinkSync(target);
    else if(item.type==="create")fs.writeFileSync(target,item.content,{flag:"wx",mode:0o600});
    else{
      const current=fs.lstatSync(target);if(!current.isFile()||current.isSymbolicLink())throw new Error("SANDBOX_CANDIDATE_TARGET_UNSAFE");
      const mode=current.mode&0o777;
      fs.writeFileSync(target,item.content,{flag:"w",mode});
    }
  }
  const manifest=snapshotInventory(snapshot,{...baseline.limits,requiredPaths:baseline.required_paths});
  const changed_paths=snapshotDelta(baseline,manifest);
  if(JSON.stringify(changed_paths.map(x=>x.path).sort())!==JSON.stringify([...seen].sort()))throw new Error("SANDBOX_CANDIDATE_UNEXPECTED_DELTA");
  const declared=candidate.patch_candidate_ref===undefined?null:assertPatchCandidateRef(candidate.patch_candidate_ref);
  const out={construction:"MATERIALIZED_VERIFIED",manifest,changed_paths,...(declared?{patch_candidate_ref:{id:declared.id,candidate_hash:declared.candidate_hash}}:{})};
  out.digest=snapshotHash(JSON.stringify({baseline_digest:baseline.digest,candidate_digest:manifest.digest,changed_paths,...(out.patch_candidate_ref?{patch_candidate_ref:out.patch_candidate_ref}:{})}));
  verifyCandidateSnapshot(snapshot,{source_snapshot:{manifest:baseline},candidate_snapshot:out,...(out.patch_candidate_ref?{patch_candidate_origin:out.patch_candidate_ref}:{})});
  return freezeSnapshot(out);
}
function buildSandboxArgs({snapshotDir,tmpDir,timeoutMs,command,args=[],nodeModules=null,allowLoopbackTcp=false}={}){if(!snapshotDir||!tmpDir||!command||!Number.isInteger(timeoutMs))throw new Error("SANDBOX_HELPER_ARGS_REQUIRED");const out=["--snapshot",snapshotDir,"--tmp",tmpDir,"--timeout-ms",String(timeoutMs)];if(nodeModules)out.push("--node-modules",nodeModules);if(allowLoopbackTcp)out.push("--allow-loopback-tcp");return[...out,"--",command,...args];}
function probeSandboxHelper({command=process.env.DEBUG_AI_SANDBOX_COMMAND||"debugai-sandbox-exec",spawnSyncImpl=cp.spawnSync}={}){const r=spawnSyncImpl(command,["--probe"],{encoding:"utf8",shell:false,timeout:5000,windowsHide:true,env:{PATH:process.env.PATH||"/usr/local/bin:/usr/bin:/bin"}}),text=String(r.stdout||r.stderr||"").trim().slice(0,500),match=text.match(/LANDLOCK_ABI=(\d+)/);return{available:r.status===0&&Boolean(match),command,landlock_abi:match?Number(match[1]):null,details:text,code:Number.isInteger(r.status)?r.status:1,error:r.error?String(r.error.message||r.error):null};}
function resolveAction(repo,action,args={}){if(!ACTIONS.has(action))throw new Error(`SANDBOX_ACTION_INVALID:${action}`);if(action==="node.check"){const rel=safeRel(args.path);if(!/\.[cm]?js$/i.test(rel))throw new Error(`SANDBOX_NODE_CHECK_EXTENSION:${rel}`);return{command:process.execPath,args:["--check",rel],label:`node --check ${rel}`};}const pkgPath=path.join(repo,"package.json");if(!fs.existsSync(pkgPath))throw new Error("SANDBOX_PACKAGE_JSON_REQUIRED");const pkg=JSON.parse(fs.readFileSync(pkgPath,"utf8").replace(/^\uFEFF/,"")),script=SCRIPT_BY_ACTION[action];if(typeof pkg?.scripts?.[script]!=="string"||!pkg.scripts[script].trim())throw new Error(`SANDBOX_SCRIPT_NOT_CONFIGURED:${script}`);const pm=packageManager(repo,pkg);return{command:pm,args:["run",script],label:`${pm} run ${script}`};}
function normalizeJobRoot(jobRoot){const root=path.resolve(String(jobRoot||""));if(!root||root===path.parse(root).root)throw new Error("SANDBOX_JOB_ROOT_INVALID");return root;}
function prepareSandboxJob({sourceRepo,jobRoot,action,args={},timeoutMs=120000,requiredPaths=[],candidate=undefined}={}){
  // Candidate operations remain strictly within the copied, isolated job directory.
  if(!sourceRepo||!jobRoot)throw new Error("SANDBOX_JOB_INPUT_REQUIRED");if(!ACTIONS.has(action))throw new Error(`SANDBOX_ACTION_INVALID:${action}`);if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw new Error("SANDBOX_TIMEOUT_INVALID");
  if(!Array.isArray(requiredPaths))throw new Error("SANDBOX_SNAPSHOT_POLICY_INVALID");
  const required=[...requiredPaths,action==="node.check"?snapshotPath(path.posix.normalize(safeRel(args.path))):"package.json"];
  const source=fs.realpathSync(sourceRepo),root=normalizeJobRoot(jobRoot),jobs=path.join(root,"jobs");fs.mkdirSync(jobs,{recursive:true});
  const jobId=`JOB_${crypto.randomBytes(12).toString("hex")}`,pending=path.join(jobs,`.pending-${jobId}`),finalDir=path.join(jobs,jobId),snapshot=path.join(pending,"repo"),tmpDir=path.join(pending,"tmp");fs.mkdirSync(pending,{recursive:false});fs.mkdirSync(tmpDir,{recursive:true});
  try{
    const copied=copySnapshot(source,snapshot,{requiredPaths:required}),staged=candidate===undefined?null:stageSandboxCandidate(snapshot,copied.manifest,candidate),request={schema:"debugai.sandbox-job/v1",job_id:jobId,action,args,timeout_ms:timeoutMs,source_snapshot:{files:copied.files,bytes:copied.bytes,skipped_symlinks:copied.skipped_symlinks,manifest:copied.manifest},...(staged?{candidate_snapshot:staged,...(staged.patch_candidate_ref?{patch_candidate_origin:staged.patch_candidate_ref}:{})}:{})};
    fs.writeFileSync(path.join(pending,"request.json"),JSON.stringify(request));fs.renameSync(pending,finalDir);return{job_id:jobId,job_dir:finalDir,request};
  }catch(error){fs.rmSync(pending,{recursive:true,force:true});throw error;}
}
function readSandboxRequest(jobDir){const raw=JSON.parse(fs.readFileSync(path.join(jobDir,"request.json"),"utf8"));if(raw?.schema!=="debugai.sandbox-job/v1"||raw.job_id!==path.basename(jobDir)||!ACTIONS.has(raw.action)||!Number.isInteger(raw.timeout_ms)||raw.timeout_ms<1000||raw.timeout_ms>300000||!raw.args||typeof raw.args!=="object"||Array.isArray(raw.args))throw new Error("SANDBOX_JOB_REQUEST_INVALID");return raw;}
function cleanupTerminalSandboxArtifacts(jobDir){if(typeof jobDir!=="string"||!jobDir)throw new Error("SANDBOX_JOB_DIR_REQUIRED");const resolved=path.resolve(jobDir),base=path.basename(resolved);if(!JOB_DIR_RE.test(base))throw new Error("SANDBOX_JOB_DIR_INVALID");for(const name of["repo","tmp"]){const target=path.join(resolved,name);if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});}return{job_id:base,heavy_artifacts_removed:true};}
function validDuration(value,label){if(!Number.isSafeInteger(value)||value<0)throw new Error(`${label}_INVALID`);return value;}
function gcSandboxJobs({jobRoot,now=Date.now(),terminalRetentionMs=6*3600e3,orphanGraceMs=30*60e3}={}){if(!Number.isFinite(now))throw new Error("SANDBOX_GC_TIME_INVALID");terminalRetentionMs=validDuration(terminalRetentionMs,"SANDBOX_TERMINAL_RETENTION");orphanGraceMs=validDuration(orphanGraceMs,"SANDBOX_ORPHAN_GRACE");const root=normalizeJobRoot(jobRoot),jobs=path.join(root,"jobs");fs.mkdirSync(jobs,{recursive:true});const report={terminal_removed:0,orphan_removed:0,pending_removed:0,active_skipped:0};for(const entry of fs.readdirSync(jobs,{withFileTypes:true})){if(!entry.isDirectory()||entry.isSymbolicLink())continue;const dir=path.join(jobs,entry.name),stat=fs.lstatSync(dir);if(PENDING_JOB_DIR_RE.test(entry.name)){if(now-stat.mtimeMs>=orphanGraceMs){fs.rmSync(dir,{recursive:true,force:true});report.pending_removed++;}continue;}if(!JOB_DIR_RE.test(entry.name))continue;const result=path.join(dir,"result.json"),active=path.join(dir,".active");if(fs.existsSync(result)){const resultStat=fs.lstatSync(result);if(now-resultStat.mtimeMs>=terminalRetentionMs){fs.rmSync(dir,{recursive:true,force:true});report.terminal_removed++;}continue;}if(fs.existsSync(active)){const activeStat=fs.lstatSync(active);if(now-activeStat.mtimeMs<orphanGraceMs){report.active_skipped++;continue;}}if(now-stat.mtimeMs>=orphanGraceMs){fs.rmSync(dir,{recursive:true,force:true});report.orphan_removed++;}}return report;}
function waitForFileSync(file,timeoutMs){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(fs.existsSync(file))return true;Atomics.wait(SIGNAL_SLEEP,0,0,10);}return false;}
function startSandboxSignalSupervisor({tmpDir,spawnImpl=cp.spawn}={}){const requestDir=fs.realpathSync(tmpDir),token=crypto.randomBytes(32).toString("hex"),ready=path.join(requestDir,SIGNAL_READY_FILE),script=path.join(__dirname,"sandbox-signal-supervisor.js");fs.rmSync(ready,{force:true});const child=spawnImpl(process.execPath,[script,requestDir,token],{cwd:__dirname,env:{PATH:process.env.PATH||"/usr/local/bin:/usr/bin:/bin"},stdio:"ignore",windowsHide:true});if(!child||!Number.isSafeInteger(child.pid)||child.pid<=1)throw new Error("SANDBOX_SIGNAL_SUPERVISOR_SPAWN_FAILED");if(!waitForFileSync(ready,2000)){try{child.kill("SIGTERM");}catch{}throw new Error("SANDBOX_SIGNAL_SUPERVISOR_READY_TIMEOUT");}return{child,request_dir:requestDir,token,ready};}
function stopSandboxSignalSupervisor(handle){if(!handle)return;try{if(handle.child?.exitCode===null&&handle.child?.signalCode===null)handle.child.kill("SIGTERM");}catch{}try{fs.rmSync(handle.ready,{force:true});}catch{}}
function buildSandboxEnv({homeDir,npmCache,nodeModules=null,requireTypeScript7Real=false}={}){if(!homeDir||!npmCache)throw new Error("SANDBOX_ENV_PATH_REQUIRED");const env={PATH:process.env.PATH||"/usr/local/bin:/usr/bin:/bin",HOME:homeDir,TMPDIR:path.dirname(homeDir),CI:"1",NO_COLOR:"1",npm_config_cache:npmCache};if(nodeModules)env.NODE_PATH=nodeModules;if(requireTypeScript7Real)env.DEBUG_AI_REQUIRE_TS7_REAL="1";return env;}
function runPreparedSandboxJob({jobDir,sandboxCommand=process.env.DEBUG_AI_SANDBOX_COMMAND||"debugai-sandbox-exec",spawnSyncImpl=cp.spawnSync,allowSupervisedSigkill=false,requireTypeScript7Real=false}={}){if(!jobDir)throw new Error("SANDBOX_JOB_DIR_REQUIRED");const request=readSandboxRequest(jobDir);if(request.candidate_snapshot){if(allowSupervisedSigkill)throw new Error("SANDBOX_CANDIDATE_PROVISION_UNSUPPORTED");verifyCandidateSnapshot(path.join(jobDir,"repo"),request);}else if(request.source_snapshot?.manifest)verifySnapshotCopy(path.join(jobDir,"repo"),request.source_snapshot.manifest,{provisioned:allowSupervisedSigkill});if(allowSupervisedSigkill&&request.action!=="package.test")throw new Error("SANDBOX_SIGNAL_SUPERVISION_ACTION_INVALID");if(requireTypeScript7Real&&(!allowSupervisedSigkill||request.action!=="package.test"))throw new Error("SANDBOX_TS7_REAL_SCOPE_INVALID");const snapshot=path.join(jobDir,"repo"),tmpDir=path.join(jobDir,"tmp"),probe=probeSandboxHelper({command:sandboxCommand,spawnSyncImpl});if(!probe.available)throw new Error(`SANDBOX_HELPER_UNAVAILABLE:${probe.error||probe.details||probe.code}`);fs.mkdirSync(tmpDir,{recursive:true});const homeDir=path.join(tmpDir,"home"),npmCache=path.join(tmpDir,"npm-cache");fs.mkdirSync(homeDir,{recursive:true});fs.mkdirSync(npmCache,{recursive:true});const resolved=resolveAction(snapshot,request.action,request.args),isPackage=String(request.action).startsWith("package."),nodeModules=isPackage&&(process.env.DEBUG_AI_SANDBOX_NODE_MODULES||(fs.existsSync("/app/node_modules")?"/app/node_modules":null)),allowLoopbackTcp=request.action==="package.test",helperArgs=buildSandboxArgs({snapshotDir:snapshot,tmpDir,timeoutMs:request.timeout_ms,command:resolved.command,args:resolved.args,nodeModules,allowLoopbackTcp}),env=buildSandboxEnv({homeDir,npmCache,nodeModules,requireTypeScript7Real});let signalSupervisor=null,r;try{if(allowSupervisedSigkill){signalSupervisor=startSandboxSignalSupervisor({tmpDir});env.DEBUG_AI_SANDBOX_SIGNAL_DIR=signalSupervisor.request_dir;env.DEBUG_AI_SANDBOX_SIGNAL_TOKEN=signalSupervisor.token;}const started=Date.now();r=spawnSyncImpl(sandboxCommand,helperArgs,{encoding:"utf8",shell:false,timeout:request.timeout_ms+5000,windowsHide:true,env});r.__duration_ms=Date.now()-started;}finally{stopSandboxSignalSupervisor(signalSupervisor);}const durationMs=Number(r?.__duration_ms||0),code=Number.isInteger(r?.status)?r.status:r?.error?.code==="ETIMEDOUT"?124:1,timedOut=code===124||r?.error?.code==="ETIMEDOUT",result={schema:"debugai.sandbox-result/v1",job_id:request.job_id,action:request.action,command:resolved.label,code,pass:code===0&&!timedOut,timed_out:timedOut,duration_ms:durationMs,stdout:String(r?.stdout||"").slice(-12000),stderr:String(r?.stderr||r?.error?.message||"").slice(-12000),isolation:{backend:"sidecar+landlock+seccomp",landlock_abi:probe.landlock_abi,container_network:"NONE_REQUIRED",network:allowLoopbackTcp?"CONTAINER_NETWORK_NONE+SANDBOX_LOOPBACK_TCP_PROFILE":"LANDLOCK_TCP_DENY+SECCOMP_SOCKET_DENY",workspace_mount:"ABSENT",secret_mounts:"ABSENT",docker_socket:"ABSENT",environment:"CLEARED_ALLOWLIST_ONLY",job_child_write_scope:snapshot,signal_ptrace:"SECCOMP_DENY",supervised_sigkill:signalSupervisor?"EXACT_SOURCE_BOUND_CHILD_ONLY":"DISABLED",typescript7_real:requireTypeScript7Real?"REQUIRED":"DEFAULT"},snapshot:request.source_snapshot,snapshot_qualification:request.candidate_snapshot||request.source_snapshot?.manifest?"MATERIALIZED_ENTRIES_MATCH":"NOT_VERIFIED",snapshot_completeness:"NOT_VERIFIED",candidate_snapshot:request.candidate_snapshot||null,candidate_construction:request.candidate_snapshot?"MATERIALIZED_VERIFIED":"NOT_CONFIGURED"};const tmpResult=path.join(jobDir,".result.json.tmp");fs.writeFileSync(tmpResult,JSON.stringify(result));fs.renameSync(tmpResult,path.join(jobDir,"result.json"));cleanupTerminalSandboxArtifacts(jobDir);return result;}
function readSandboxResult({jobRoot,jobId}={}){const file=path.join(normalizeJobRoot(jobRoot),"jobs",String(jobId||""),"result.json");if(!fs.existsSync(file))return null;const result=JSON.parse(fs.readFileSync(file,"utf8"));if(result?.schema!=="debugai.sandbox-result/v1"||result.job_id!==jobId)throw new Error("SANDBOX_RESULT_INVALID");return result;}
async function waitSandboxResult({jobRoot,jobId,timeoutMs=310000,pollMs=100}={}){const started=Date.now();for(;;){const result=readSandboxResult({jobRoot,jobId});if(result)return result;if(Date.now()-started>=timeoutMs)throw new Error(`SANDBOX_RESULT_TIMEOUT:${jobId}`);await new Promise(resolve=>setTimeout(resolve,pollMs));}}
module.exports={ACTIONS,protectedRel,safeRel,snapshotInventory,assertSnapshotManifest,verifySnapshotCopy,verifyCandidateSnapshot,stageSandboxCandidate,copySnapshot,buildSandboxArgs,probeSandboxHelper,resolveAction,normalizeJobRoot,prepareSandboxJob,readSandboxRequest,cleanupTerminalSandboxArtifacts,gcSandboxJobs,waitForFileSync,startSandboxSignalSupervisor,stopSandboxSignalSupervisor,buildSandboxEnv,runPreparedSandboxJob,readSandboxResult,waitSandboxResult};
