"use strict";
// Uses the existing investigation, patch-candidate and read-only verification
// lanes. Test-only nested workspaces; no new provider, approval or apply path.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {corpus,digest,payload,writeNew,marker,select}=require("../../scripts/real-debug-suite.cjs");
const {isolatedOperations}=require("./sandbox-patch-candidate.js");
const {repositorySnapshotId}=require("./repository-snapshot.js");
const {isRoleWorkItemPending}=require("./role-work-item/pending.js");
const SCHEMA="debugai.real-debug-benchmark/v1";
const ID=/^realdebug_[a-f0-9]{32}$/;
const TERMINAL=new Set(["DONE","BLOCKED","FAILED","CANCELLED","PAUSED"]);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const code=e=>String(e?.code||e?.message||"UNKNOWN").split(":")[0].slice(0,100);
const corpusDigest=digest(JSON.stringify(corpus));
function safeDir(parent,name){
  if(!/^[a-zA-Z0-9_.-]+$/.test(name)||name==="."||name==="..")throw Error("BENCHMARK_PATH_INVALID");
  const target=path.join(parent,name);
  try{fs.mkdirSync(target,{mode:0o700});}catch(e){if(e.code!=="EEXIST")throw e;}
  const st=fs.lstatSync(target);if(!st.isDirectory()||st.isSymbolicLink()||fs.realpathSync(target)!==target)throw Error("BENCHMARK_PATH_UNSAFE");
  return target;
}
function selectCases(ids){
  if(ids===undefined)return corpus.cases.map(c=>c.id);
  if(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length)throw Error("BENCHMARK_CASE_IDS_INVALID");
  ids.forEach(select);return corpus.cases.map(c=>c.id).filter(id=>ids.includes(id));
}
function exactFixture(repo,expected){
  const actual=[];
  function walk(dir){for(const name of fs.readdirSync(dir).sort()){const p=path.join(dir,name),s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error("BENCHMARK_FIXTURE_SYMLINK");if(s.isDirectory()){walk(p);continue;}if(!s.isFile())throw Error("BENCHMARK_FIXTURE_TYPE");actual.push(path.relative(repo,p).split(path.sep).join("/"));}}
  walk(repo);if(JSON.stringify(actual.sort())!==JSON.stringify(Object.keys(expected).sort()))throw Error("BENCHMARK_FIXTURE_SCOPE_CHANGED");
  for(const [f,v] of Object.entries(expected))if(fs.readFileSync(path.join(repo,f),"utf8")!==v)throw Error("BENCHMARK_FIXTURE_CONTENT_CHANGED");
  return true;
}
function requestFor(c,repo){
  const task="Investigate the reproducible defect in this isolated program. Expected behavior: "+c.contract+" Run the existing tests, identify the actual cause with source evidence and propose a minimal source-only correction. Preserve the tests, package scripts and contract. Do not apply, deploy or publish.";
  return {repo,projectId:"debugai-real-debug-"+c.id,rawRequest:task,failure:{message:"Existing reproduction test fails against the specified behavior.",source_paths:Object.keys(c.files),test_paths:["reproduce.cjs"],requirements:{requested_behavior:[c.contract],preserved_behavior:["Keep existing public API and unrelated behavior."],forbidden_changes:["Do not change or skip tests or change package scripts."],forbidden_paths:["reproduce.cjs","package.json","README.md"],acceptance_conditions:["Existing reproduction and independent contract tests must pass."],required_tests:["npm test"],boundary_cases:[],negative_cases:[],unknowns:["Independent holdout tests are withheld during diagnosis and patch generation."]}}};
}
function executedChecks(verification){return Array.isArray(verification?.checks)?verification.checks:[];}
function measuredTest(v,checks,{red=false}={}){
  const test=executedChecks(v).find(c=>c.check_type==="UNIT"&&c.executed===true);
  if(!test||test.timed_out||test.sandbox?.backend!=="sidecar+landlock+seccomp")return false;
  if(red)return test.status==="FAIL"&&Number.isInteger(test.exit_code)&&test.exit_code!==0&&/AssertionError/.test(test.stderr||"");
  return test.status==="PASS"&&test.exit_code===0&&(test.stdout||"").split(/\r?\n/).includes(marker(checks));
}
function makeSummary(rows,total){
  const byLevel={};for(let l=1;l<=5;l++){const r=rows.filter(x=>x.level===l);byLevel[l]={completed:r.length,repair_pass:r.filter(x=>x.repair_pass===true).length,review_pass:r.filter(x=>x.review_pass===true).length,blocked:r.filter(x=>x.state==="BLOCKED").length};}
  return {total,completed:rows.length,repair_pass:rows.filter(x=>x.repair_pass===true).length,review_pass:rows.filter(x=>x.review_pass===true).length,failed:rows.filter(x=>x.state==="FAILED").length,blocked:rows.filter(x=>x.state==="BLOCKED").length,unreviewed_diagnoses:rows.filter(x=>x.diagnosis&&x.cause_accuracy==="UNREVIEWED").length,by_level:byLevel};
}
function candidateScope(candidate,repo,c){
  if(candidate?.repo!==repo||!Array.isArray(candidate.files)||!candidate.files.length||!Array.isArray(candidate.operations))throw Error("BENCHMARK_CANDIDATE_SCOPE_INVALID");
  const allowed=new Set(Object.keys(c.files));for(const f of candidate.files)if(!allowed.has(f))throw Error("BENCHMARK_CANDIDATE_SCOPE_INVALID");
  for(const op of candidate.operations)if(!allowed.has(op.path)||op.type!=="replace")throw Error("BENCHMARK_CANDIDATE_SCOPE_INVALID");
  return isolatedOperations(candidate).operations;
}
function gradePayload(c,operations){
  const out=payload(c,{holdout:true});
  for(const op of operations){if(op.type!=="replace"||!Object.hasOwn(c.files,op.path)||typeof op.content_utf8!=="string")throw Error("BENCHMARK_CANDIDATE_SCOPE_INVALID");out[op.path]=op.content_utf8;}
  return out;
}
function createRealDebugBenchmark({workflow,repoPolicy,runtimeEvidence,authority=null,pollMs=2000,analysisDeadlineMs=60*60e3,now=Date.now,wait=sleep}={}){
  if(!workflow||!repoPolicy||!runtimeEvidence)throw Error("REAL_DEBUG_PORT_REQUIRED");
  let active=null;
  const statusOf=id=>{if(!ID.test(String(id)))throw Error("REAL_DEBUG_ID_INVALID");return runtimeEvidence.list(id,{types:["real_debug_benchmark"],limit:1})[0]?.payload||null;};
  function save(cp){const data={...cp,updated_at:now(),summary:makeSummary(cp.results,cp.case_ids.length)};runtimeEvidence.write(cp.benchmark_id,"real_debug_benchmark",data);return data;}
  function status(id){const cp=statusOf(id);if(!cp)throw Error("REAL_DEBUG_NOT_FOUND");return {...cp,active_in_process:active===id,interrupted:cp.state==="RUNNING"&&active!==id};}
  function baseDir(id){
    const parent=repoPolicy.assertRepo(path.join(repoPolicy.workspaceRoot,"debug-ai"));
    if(fs.realpathSync(parent)!==parent)throw Error("BENCHMARK_PARENT_INVALID");
    const root=safeDir(safeDir(parent,".verification"),"real-debug");
    return safeDir(root,id);
  }
  async function waitAnalysis(runId){
    const deadline=now()+analysisDeadlineMs;
    for(;;){const r=await workflow.status(runId),d=r.durable;if(!d)throw Error("REAL_DEBUG_DURABLE_REQUIRED");
      if(TERMINAL.has(d.job_status)&&!d.active_in_process)return r;
      if(now()>=deadline)throw Error("REAL_DEBUG_ANALYSIS_TIMEOUT");await wait(pollMs);
    }
  }
  async function runOne(cp,c,base){
    const initial=payload(c),repo=path.join(base,c.id),task=requestFor(c,repo);
    let current=cp.current;
    if(current&&current.case_id!==c.id)throw Error("REAL_DEBUG_CHECKPOINT_CASE_MISMATCH");
    if(!current){
      if(fs.existsSync(repo))throw Error("REAL_DEBUG_WORKSPACE_EXISTS");
      writeNew(repo,initial);repoPolicy.assertRepo(repo);exactFixture(repo,initial);
      current={case_id:c.id,phase:"STARTING",run_id:null,started_at:now(),snapshot:repositorySnapshotId(repo,{allowMissingGitMarker:true})};cp.current=current;save(cp);
      const started=await workflow.startAnalysis(task);
      if(!started?.run_id)throw Error("REAL_DEBUG_RUN_ID_MISSING");
      current.run_id=started.run_id;current.phase="ANALYSIS";save(cp);
    }
    if(!current.run_id)throw Error("REAL_DEBUG_START_UNCERTAIN");
    exactFixture(repo,initial);
    if(current.snapshot!==repositorySnapshotId(repo,{allowMissingGitMarker:true}))throw Error("REAL_DEBUG_FIXTURE_REVISION_CHANGED");
    const r=await waitAnalysis(current.run_id),d=r.durable;
    const row={id:c.id,level:c.level,run_id:current.run_id,duration_ms:now()-current.started_at,analysis_state:d.job_status,analysis_step:d.workflow_cursor?.step_id||null,role_invocations:d.role_invocations||[],public_red:false,public_green:false,holdout_green:false,scope_pass:false,source_unchanged:true,repair_pass:false,review_pass:false,cause_accuracy:"UNREVIEWED",state:"BLOCKED"};
    if(d.job_status!=="DONE"){row.error_code=d.last_execution_error||d.last_execution_failure?.code||d.job_status;return row;}
    const inspected=await workflow.inspect(current.run_id),analysis=inspected.artifacts?.analysis?.payload;
    if(!analysis){row.error_code="ANALYSIS_EVIDENCE_MISSING";return row;}
    row.public_red=measuredTest(analysis.deterministic_verification,c.public_checks,{red:true});
    row.diagnosis=analysis.diagnosis||null;row.hypothesis_review=analysis.external_hypothesis_review?.json?.verdict||analysis.local_hypothesis_review?.json?.verdict||null;
    if(!row.public_red||row.hypothesis_review!=="PASS"){row.error_code=!row.public_red?"PUBLIC_RED_NOT_PROVEN":"HYPOTHESIS_REVIEW_NOT_PASS";return row;}
    // Resume ONLY a positively identified pending work-item step, never a blind
    // repeat of a timed out/unknown candidate call.
    if(current.phase!=="ANALYSIS"&&current.phase!=="PATCH_CONTINUE")throw Error("REAL_DEBUG_PATCH_OUTCOME_UNCERTAIN");
    let result=null;
    for(let n=0;n<12;n++){
      current.phase="PATCH_IN_PROGRESS";save(cp);
      try{result=await workflow.patchCandidate({runId:current.run_id,analysis,repo,selectedPaths:Object.keys(c.files),context:{requirements:task.failure.requirements},task:task.rawRequest});break;}
      catch(e){if(!isRoleWorkItemPending(e?.code))throw e;current.phase="PATCH_CONTINUE";save(cp);}
    }
    if(!result)throw Error("REAL_DEBUG_PATCH_BUDGET_EXHAUSTED");
    row.candidate_id=result.candidate?.id||null;row.candidate_hash=result.candidate?.candidate_hash||null;
    row.public_green=measuredTest(result.candidate_verification,c.public_checks);
    const operations=candidateScope(result.candidate,repo,c);row.scope_pass=true;
    exactFixture(repo,initial);row.source_unchanged=true;
    if(!row.public_green){row.state="FAILED";row.error_code="CANDIDATE_PUBLIC_NOT_PASS";return row;}
    // The holdout is only materialized AFTER the candidate exists. The candidate
    // never executes in the app or on the Host; existing read-only verification
    // executes it in the isolated sidecar. Do not issue an apply receipt.
    current.phase="HOLDOUT_IN_PROGRESS";save(cp);
    const grade=path.join(base,c.id+"-grade");if(fs.existsSync(grade))throw Error("REAL_DEBUG_GRADE_EXISTS");
    const grading=gradePayload(c,operations);writeNew(grade,grading);repoPolicy.assertRepo(grade);exactFixture(grade,grading);
    const check=await workflow.verifyReadOnly({repo:grade,selectedPaths:operations.map(x=>x.path),changeScope:operations.map(x=>x.path),task:"Independent contract verification of the already generated candidate; do not modify any files."});
    row.holdout_verification_id=check.verification_id||null;
    row.holdout_green=measuredTest(check.deterministic_verification,c.holdout_checks);
    row.review_pass=check.verdict==="PASS";row.local_review=check.local_review?.verdict||null;
    exactFixture(repo,initial);exactFixture(grade,grading);
    row.source_unchanged=check.invariants?.pass===true;
    row.repair_pass=row.public_red&&row.public_green&&row.holdout_green&&row.scope_pass&&row.source_unchanged;
    row.state=row.repair_pass?"DONE":"FAILED";row.error_code=row.repair_pass?null:"INDEPENDENT_HOLDOUT_NOT_PASS";
    row.duration_ms=now()-current.started_at;
    return row;
  }
  async function execute(cp){
    try{
      const base=baseDir(cp.benchmark_id);
      for(const id of cp.case_ids){
        if(cp.results.some(x=>x.id===id))continue;
        const c=select(id);
        try{cp.results.push(await runOne(cp,c,base));}
        catch(e){
          const error=code(e),current=cp.current;
          // Unknown submission/timeout is NOT a license to start another model
          // call. Preserve the current item, stop the suite and require readback.
          if(["REAL_DEBUG_ANALYSIS_TIMEOUT","REAL_DEBUG_START_UNCERTAIN","REAL_DEBUG_PATCH_OUTCOME_UNCERTAIN"].includes(error)||["STARTING","PATCH_IN_PROGRESS","HOLDOUT_IN_PROGRESS"].includes(current?.phase)&&!current?.run_id){
            cp.state="INCOMPLETE";cp.error_code=error;save(cp);return;
          }
          cp.results.push({id:c.id,level:c.level,run_id:current?.run_id||null,state:"BLOCKED",error_code:error,repair_pass:false,review_pass:false,source_unchanged:null,cause_accuracy:"UNREVIEWED"});
        }
        cp.current=null;save(cp);
      }
      cp.state="DONE";cp.finished_at=now();save(cp);
    }catch(e){cp.state="INCOMPLETE";cp.error_code=code(e);save(cp);}
    finally{active=null;}
  }
  function start(input={}){
    if(active)throw Error("REAL_DEBUG_SUITE_ACTIVE");
    // The previous live run and existing work are not interrupted or duplicated.
    const recovered=authority?.inspectDurableRuns?.().recoverable||[];
    const resumed=input.benchmark_id?statusOf(input.benchmark_id):null;
    if(input.benchmark_id&&!resumed)throw Error("REAL_DEBUG_NOT_FOUND");
    if(resumed&&(resumed.corpus_digest!==corpusDigest||resumed.state==="DONE"))throw Error("REAL_DEBUG_RESUME_NOT_APPLICABLE");
    if(recovered.some(x=>x.run_id!==resumed?.current?.run_id))throw Error("REAL_DEBUG_OTHER_RUN_ACTIVE");
    const cp=resumed?{...resumed,state:"RUNNING",error_code:null}:{schema:SCHEMA,benchmark_id:"realdebug_"+crypto.randomUUID().replaceAll("-",""),corpus_version:corpus.version,corpus_digest:corpusDigest,case_ids:selectCases(input.case_ids),state:"RUNNING",started_at:now(),results:[],current:null};
    active=cp.benchmark_id;save(cp);void execute(cp);
    return {schema:SCHEMA,benchmark_id:cp.benchmark_id,state:"RUNNING",total:cp.case_ids.length,corpus_digest:corpusDigest};
  }
  return {start,status};
}
module.exports={SCHEMA,corpusDigest,selectCases,exactFixture,requestFor,measuredTest,makeSummary,gradePayload,createRealDebugBenchmark};
