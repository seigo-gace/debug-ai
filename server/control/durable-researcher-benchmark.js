"use strict";
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {performance}=require("node:perf_hooks");
const {ROLES}=require("../roles.js");
const benchmark=require("./researcher-skill-effect-benchmark.js");

const RUN_SCHEMA="debugai.durable-benchmark-run/v1";
const STATE_SCHEMA="debugai.durable-benchmark-state/v1";
const CHECKPOINT_SCHEMA="debugai.durable-benchmark-checkpoint/v1";
const BENCHMARK_ID="researcher-skill-effect-v1";

function iso(now){return new Date(now()).toISOString();}
function safeError(error){return String(error?.message||error||"UNKNOWN_ERROR").replace(/Bearer\s+\S+/gi,"Bearer [REDACTED]").slice(0,500);}
function atomicJson(file,value){const temporary=`${file}.${process.pid}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});fs.renameSync(temporary,file);}
function appendJsonl(file,value){const fd=fs.openSync(file,"a",0o600);try{fs.writeSync(fd,`${JSON.stringify(value)}\n`);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function readJson(file){return JSON.parse(fs.readFileSync(file,"utf8"));}
function readJsonl(file){if(!fs.existsSync(file))return[];return fs.readFileSync(file,"utf8").split("\n").filter(Boolean).map(line=>JSON.parse(line));}
function fingerprint(identity){return crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");}
function identityFromEnvironment(env=process.env){
  const exact_git_sha=String(env.DEBUG_AI_BENCHMARK_GIT_SHA||"").trim();
  const branch=String(env.DEBUG_AI_BENCHMARK_BRANCH||"").trim();
  if(!/^[0-9a-f]{40}$/.test(exact_git_sha))throw new Error("BENCHMARK_GIT_SHA_REQUIRED");
  if(!branch)throw new Error("BENCHMARK_BRANCH_REQUIRED");
  return Object.freeze({benchmark_id:BENCHMARK_ID,exact_git_sha,branch,model:ROLES[benchmark.ROLE].backend_model,temperature:0,token_budget:benchmark.MAX_TOKENS});
}
function assertIdentity(actual,expected){for(const key of Object.keys(expected))if(actual?.[key]!==expected[key])throw new Error(`BENCHMARK_RESUME_IDENTITY_MISMATCH:${key}`);}
function completedMap(checkpoints,runFingerprint){
  const out=new Map();
  for(const item of checkpoints){if(item.fingerprint!==runFingerprint||item.status!=="COMPLETED")continue;out.set(`${item.case_id}:${item.mode}`,item);}
  return out;
}
function stateFrom({currentCase=null,currentMode=null,completed,failedCount,lastCompletedCase=null,lastError=null,alive,now}){
  return {schema:STATE_SCHEMA,current_case:currentCase,current_mode:currentMode,completed_count:completed.size,failed_count:failedCount,last_completed_case:lastCompletedCase,last_error:lastError,updated_at:iso(now),process_alive:alive};
}
function buildResult(completed,elapsedMs){
  const results=[],totals={on:0,off:0,max:benchmark.CASES.length*5};
  for(const testCase of benchmark.CASES){
    const pair={case_id:testCase.id,selected_skill_ids:[...testCase.skills]};
    for(const mode of ["off","on"]){const item=completed.get(`${testCase.id}:${mode}`);if(!item)throw new Error(`BENCHMARK_CHECKPOINT_MISSING:${testCase.id}:${mode}`);pair[mode]=item.result;totals[mode]+=item.result.score;}
    results.push(pair);
  }
  const delta=totals.on-totals.off;
  return {schema:benchmark.SCHEMA,authority:"MEASUREMENT_ONLY",completed:true,role:benchmark.ROLE,model:ROLES[benchmark.ROLE].backend_model,temperature:0,token_budget:benchmark.MAX_TOKENS,skill_selection_boundary:"MAX_3_PER_INVOCATION",cases:results,score:{skill_on:totals.on,skill_off:totals.off,max:totals.max,delta,winner:delta>0?"SKILL_ON":delta<0?"SKILL_OFF":"TIE",effect_demonstrated:delta>0},elapsed_ms:Math.max(0,Math.round(elapsedMs))};
}
async function runDurableResearcherBenchmark({runDir,identity=identityFromEnvironment(),callModel,clock=performance,now=Date.now,pid=process.pid}={}){
  if(!runDir)throw new Error("BENCHMARK_RUN_DIR_REQUIRED");
  fs.mkdirSync(runDir,{recursive:true,mode:0o700});
  const backendKey=crypto.createHash("sha256").update(ROLES[benchmark.ROLE].backend_model).digest("hex").slice(0,16);
  const files={metadata:path.join(runDir,"metadata.json"),state:path.join(runDir,"state.json"),checkpoints:path.join(runDir,"checkpoints.jsonl"),result:path.join(runDir,"result.json"),lock:path.join(runDir,"active.lock"),backendLock:path.join(path.dirname(runDir),`backend-${backendKey}.lock`)};
  const started=clock.now();let completed=new Map(),failedCount=0,lastCompletedCase=null,lastError=null;
  let runLocked=false,backendLocked=false;
  try{
    let lockFd=fs.openSync(files.lock,"wx",0o600);fs.writeSync(lockFd,`${pid}\n`);fs.closeSync(lockFd);runLocked=true;
    lockFd=fs.openSync(files.backendLock,"wx",0o600);fs.writeSync(lockFd,`${pid}\n`);fs.closeSync(lockFd);backendLocked=true;
    const runFingerprint=fingerprint(identity);
    const startedAt=iso(now);
    if(fs.existsSync(files.metadata)){
      const metadata=readJson(files.metadata);assertIdentity(metadata,identity);const attempts=Array.isArray(metadata.attempts)?metadata.attempts:[];atomicJson(files.metadata,{...metadata,pid,attempts:[...attempts,{started_at:startedAt,pid}]});
    }else{
      atomicJson(files.metadata,{schema:RUN_SCHEMA,...identity,fingerprint:runFingerprint,started_at:startedAt,pid,attempts:[{started_at:startedAt,pid}]});
    }
    const checkpoints=readJsonl(files.checkpoints);completed=completedMap(checkpoints,runFingerprint);failedCount=checkpoints.filter(x=>x.fingerprint===runFingerprint&&x.status==="FAILED").length;
    const client=callModel||benchmark.defaultClient();
    atomicJson(files.state,stateFrom({completed,failedCount,lastCompletedCase,lastError,alive:true,now}));
    for(const testCase of benchmark.CASES){
      const systems=benchmark.buildSystemsForCase(testCase);const user=JSON.stringify({benchmark_case:testCase.id,...testCase.input});
      for(const mode of ["off","on"]){
        const key=`${testCase.id}:${mode}`;if(completed.has(key)){lastCompletedCase=testCase.id;continue;}
        atomicJson(files.state,stateFrom({currentCase:testCase.id,currentMode:mode,completed,failedCount,lastCompletedCase,lastError:null,alive:true,now}));
        const inferenceStarted=clock.now();
        try{
          const reply=await client({mode,system:systems[mode],user,case:testCase});const parsed=benchmark.parseJson(reply.content);const scored=benchmark.scoreCase(testCase,parsed);const checkpoint={schema:CHECKPOINT_SCHEMA,fingerprint:runFingerprint,benchmark_id:BENCHMARK_ID,case_id:testCase.id,mode,status:"COMPLETED",completed_at:iso(now),result:{...scored,elapsed_ms:Math.max(0,Math.round(clock.now()-inferenceStarted)),output:parsed}};
          appendJsonl(files.checkpoints,checkpoint);completed.set(key,checkpoint);lastCompletedCase=testCase.id;lastError=null;atomicJson(files.state,stateFrom({completed,failedCount,lastCompletedCase,lastError,alive:true,now}));
        }catch(error){
          lastError=safeError(error);failedCount+=1;appendJsonl(files.checkpoints,{schema:CHECKPOINT_SCHEMA,fingerprint:runFingerprint,benchmark_id:BENCHMARK_ID,case_id:testCase.id,mode,status:"FAILED",completed_at:iso(now),error:lastError});atomicJson(files.state,stateFrom({currentCase:testCase.id,currentMode:mode,completed,failedCount,lastCompletedCase,lastError,alive:false,now}));throw error;
        }
      }
    }
    const result=buildResult(completed,clock.now()-started);atomicJson(files.result,result);atomicJson(files.state,stateFrom({completed,failedCount,lastCompletedCase,lastError:null,alive:false,now}));return result;
  }finally{
    for(const [locked,file] of [[backendLocked,files.backendLock],[runLocked,files.lock]])if(locked)try{fs.unlinkSync(file);}catch(error){if(error?.code!=="ENOENT")throw error;}
  }
}
async function cli(){
  const index=process.argv.indexOf("--run-dir");const runDir=index>=0?process.argv[index+1]:process.env.DEBUG_AI_BENCHMARK_RUN_DIR;
  try{const result=await runDurableResearcherBenchmark({runDir});process.stdout.write(`${JSON.stringify({event:"BENCHMARK_COMPLETE",score:result.score})}\n`);}
  catch(error){process.stderr.write(`${JSON.stringify({event:"BENCHMARK_FAILED",error:safeError(error)})}\n`);process.exitCode=1;}
}
if(require.main===module)void cli();
module.exports={RUN_SCHEMA,STATE_SCHEMA,CHECKPOINT_SCHEMA,BENCHMARK_ID,identityFromEnvironment,fingerprint,completedMap,buildResult,runDurableResearcherBenchmark};
