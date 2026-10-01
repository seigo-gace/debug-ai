"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");

const {
  SOURCE_REQUIREMENTS,
  CONTAINER_SOURCE_REQUIREMENTS,
  sanitizeRemote,
  repositoryIdentity,
  gitReadback,
  sourceReadback,
  dockerReadback,
  containerSourceReadback,
  healthOk,
  collectReadback,
}=require("../../scripts/live-runtime-readback.cjs");

function tempRepo(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-live-readback-"));
  return{root,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}

function write(root,rel,content=""){
  const target=path.join(root,rel);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,content);
}

function makeCompatibleCheckout(root){
  for(const rel of SOURCE_REQUIREMENTS){
    let content="";
    if(rel.endsWith("search-gate-candidate-policy.js"))content='const POLICY_VERSION="debugai.search-gate-candidate-policy/v1";\n';
    if(rel.endsWith("search-gate-shadow-runtime.js"))content='const POLICY_VERSION="debugai.search-gate-shadow-runtime/v2";\n';
    write(root,rel,content);
  }
  write(root,"package.json",JSON.stringify({scripts:{"audit:search-gate-shadow":"node scripts/search-gate-shadow-audit.cjs"}}));
}

function trackedProbePath(args){
  if(args[0]!=="ls-files"||args[1]!=="--error-unmatch"||args[2]!=="--"||args.length!==4)return null;
  return args[3];
}

function baseGitResult({root,origin="git@github.com:seigo-gace/debug-ai.git",head="c".repeat(40),branch="feat/runtime",tracked=true}={}){
  return(command,args)=>{
    const key=args.join(" ");
    if(command==="git"&&key==="rev-parse --show-toplevel")return{ok:true,status:0,stdout:`${root}\n`,error_code:null};
    if(command==="git"&&key==="config --get remote.origin.url")return{ok:true,status:0,stdout:`${origin}\n`,error_code:null};
    if(command==="git"&&key==="branch --show-current")return{ok:true,status:0,stdout:`${branch}\n`,error_code:null};
    if(command==="git"&&key==="rev-parse HEAD")return{ok:true,status:0,stdout:`${head}\n`,error_code:null};
    if(command==="git"&&key.startsWith("diff "))return{ok:true,status:0,stdout:"",error_code:null};
    const rel=command==="git"?trackedProbePath(args):null;
    if(rel&&SOURCE_REQUIREMENTS.includes(rel))return tracked?{ok:true,status:0,stdout:`${rel}\n`,error_code:null}:{ok:false,status:1,stdout:"",error_code:null};
    return null;
  };
}

function sourceProbeOutput({auditCli=true}={}){
  const required_files=Object.fromEntries(CONTAINER_SOURCE_REQUIREMENTS.map(p=>[p,true]));
  if(!auditCli)required_files["/app/scripts/search-gate-shadow-audit.cjs"]=false;
  return JSON.stringify({required_files,candidate_policy_version:"debugai.search-gate-candidate-policy/v1",shadow_runtime_policy_version:"debugai.search-gate-shadow-runtime/v2"});
}

function auditOutput(overrides={}){
  return JSON.stringify({
    schema:"debugai.search-gate-shadow-store-audit/v1",
    read_only:true,
    activation_authorized:false,
    activation_decision:"NOT_AUTHORIZED_BY_SHADOW_AUDIT",
    window_status:"NO_CANDIDATE_OBSERVATIONS",
    false_skip_assessment:"NOT_EVALUABLE",
    candidate_skip_observations:0,
    evaluable_candidate_skip_observations:0,
    false_skip_observations:0,
    ...overrides,
  });
}

test("live readback redacts HTTPS remote credentials and normalizes repository identity",()=>{
  assert.equal(sanitizeRemote("https://secret-token@github.com/seigo-gace/debug-ai.git\n"),"https://***@github.com/seigo-gace/debug-ai.git");
  assert.equal(sanitizeRemote("git@github.com:seigo-gace/debug-ai.git"),"git@github.com:seigo-gace/debug-ai.git");
  assert.equal(repositoryIdentity("https://token@github.com/seigo-gace/debug-ai.git"),"github.com/seigo-gace/debug-ai");
  assert.equal(repositoryIdentity("git@github.com:seigo-gace/debug-ai.git"),"github.com/seigo-gace/debug-ai");
  assert.equal(repositoryIdentity("ssh://git@github.com/seigo-gace/debug-ai.git"),"github.com/seigo-gace/debug-ai");
  assert.equal(repositoryIdentity("https://github.com/other/debug-ai.git"),"github.com/other/debug-ai");
});

test("git readback never enumerates untracked files and only reports bounded dirty state",()=>{
  const calls=[];
  const runner=(command,args,options)=>{
    calls.push([command,...args]);
    const key=args.join(" ");
    if(key==="rev-parse --show-toplevel")return{ok:true,status:0,stdout:"/srv/debug-ai\n",error_code:null};
    if(key==="config --get remote.origin.url")return{ok:true,status:0,stdout:"https://token@github.com/seigo-gace/debug-ai.git\n",error_code:null};
    if(key==="branch --show-current")return{ok:true,status:0,stdout:"feat/runtime\n",error_code:null};
    if(key==="rev-parse HEAD")return{ok:true,status:0,stdout:"a".repeat(40)+"\n",error_code:null};
    if(key.startsWith("diff --quiet"))return{ok:false,status:1,stdout:"",error_code:null};
    if(key.startsWith("diff --cached"))return{ok:true,status:0,stdout:"",error_code:null};
    const rel=trackedProbePath(args);
    if(rel&&SOURCE_REQUIREMENTS.includes(rel))return{ok:true,status:0,stdout:`${rel}\n`,error_code:null};
    throw new Error(`UNEXPECTED_COMMAND:${command} ${key} CWD=${options?.cwd}`);
  };
  const out=gitReadback("/start",runner);
  assert.equal(out.repository_detected,true);
  assert.equal(out.root,"/srv/debug-ai");
  assert.equal(out.origin,"https://***@github.com/seigo-gace/debug-ai.git");
  assert.equal(out.repository_identity,"github.com/seigo-gace/debug-ai");
  assert.equal(out.repository_identity_match,true);
  assert.equal(out.tracked_worktree_dirty,true);
  assert.equal(out.index_dirty,false);
  assert.equal(out.untracked_scanned,false);
  assert.equal(out.untracked_state,"NOT_SCANNED_TO_AVOID_UNBOUNDED_FILE_ENUMERATION");
  assert.equal(calls.some(call=>call.includes("status")),false);
  const trackedCalls=calls.filter(call=>call[0]==="git"&&call[1]==="ls-files");
  assert.equal(trackedCalls.length,SOURCE_REQUIREMENTS.length);
  assert.deepEqual(trackedCalls.map(call=>call[4]).sort(),[...SOURCE_REQUIREMENTS].sort());
});

test("checkout source readback requires candidate, runtime and read-only audit source",()=>{
  const f=tempRepo();
  try{
    makeCompatibleCheckout(f.root);
    const out=sourceReadback(f.root);
    assert.equal(out.search_shadow_source_compatible,true);
    assert.equal(out.candidate_policy_version,"debugai.search-gate-candidate-policy/v1");
    assert.equal(out.shadow_runtime_policy_version,"debugai.search-gate-shadow-runtime/v2");
    fs.rmSync(path.join(f.root,"scripts/search-gate-shadow-audit.cjs"));
    assert.equal(sourceReadback(f.root).search_shadow_source_compatible,false);
  }finally{f.cleanup();}
});

test("docker readback parses only filtered bounded container rows",()=>{
  const runner=(command,args)=>{
    assert.equal(command,"docker");
    assert.deepEqual(args.slice(0,3),["ps","--filter","label=com.docker.compose.service=debug-ai"]);
    return{ok:true,status:0,stdout:"abc123\tdebug-ai\tdebug-ai:test\tUp 5 minutes (healthy)\ndef456\tdebug-ai-shadow\tdebug-ai:test\tUp 2 minutes\n",error_code:null};
  };
  const out=dockerReadback(runner);
  assert.equal(out.available,true);
  assert.equal(out.container_count,2);
  assert.deepEqual(out.containers[0],{id:"abc123",name:"debug-ai",image:"debug-ai:test",status:"Up 5 minutes (healthy)"});
});

test("running container source proof requires exactly one container and every measurement source file",()=>{
  const docker={available:true,container_count:1,containers:[{id:"abc123",name:"debug-ai",image:"debug-ai:test",status:"Up"}],error_code:null};
  const runner=(command,args)=>{
    assert.equal(command,"docker");
    assert.equal(args[0],"exec");
    assert.equal(args[1],"abc123");
    return{ok:true,status:0,stdout:sourceProbeOutput(),error_code:null};
  };
  const out=containerSourceReadback(docker,runner);
  assert.equal(out.checked,true);
  assert.equal(out.compatible,true);
  assert.equal(out.reason,"SOURCE_COMPATIBLE");
  assert.equal(out.required_files["/app/scripts/search-gate-shadow-audit.cjs"],true);
  const missingCli=containerSourceReadback(docker,()=>({ok:true,status:0,stdout:sourceProbeOutput({auditCli:false}),error_code:null}));
  assert.equal(missingCli.compatible,false);
  assert.equal(missingCli.reason,"SOURCE_BEHIND_OR_INCOMPLETE");
  assert.equal(containerSourceReadback({...docker,container_count:2,containers:[docker.containers[0],docker.containers[0]]},runner).compatible,false);
});

test("combined live readback never authorizes search skip and never measures when source is incompatible",async()=>{
  const f=tempRepo();
  try{
    write(f.root,"package.json",JSON.stringify({scripts:{}}));
    const git=baseGitResult({root:f.root,branch:"main",head:"b".repeat(40),tracked:false});
    const runner=(command,args)=>{
      const result=git(command,args);if(result)return result;
      if(command==="docker")return{ok:true,status:0,stdout:"",error_code:null};
      throw new Error(`UNEXPECTED:${command}:${args.join(" ")}`);
    };
    const health=async()=>({reachable:true,status_code:200,ok:true,service:"debug-ai",error_code:null});
    const out=await collectReadback({cwd:f.root,runner,health});
    assert.equal(out.read_only,true);
    assert.equal(out.mutation_attempted,false);
    assert.equal(out.checkout_source_proven,false);
    assert.equal(out.runtime_source_state,"RUNTIME_SOURCE_BEHIND_OR_UNKNOWN");
    assert.equal(out.search_shadow_measurement_authorized,false);
    assert.equal(out.search_shadow_measurement_executed,false);
    assert.equal(out.search_shadow_measurement_pass,false);
    assert.equal(out.shadow_audit,null);
    assert.equal(out.shadow_audit_error_code,"MEASUREMENT_NOT_AUTHORIZED");
    assert.equal(out.search_skip_activation_authorized,false);
  }finally{f.cleanup();}
});

test("wrong repository identity cannot become a proven compatible checkout",async()=>{
  const f=tempRepo();
  try{
    makeCompatibleCheckout(f.root);
    const git=baseGitResult({root:f.root,origin:"git@github.com:other/debug-ai.git"});
    let auditCalls=0;
    const runner=(command,args)=>{
      const result=git(command,args);if(result)return result;
      if(command==="docker"&&args[0]==="ps")return{ok:true,status:0,stdout:"abc123\tdebug-ai\tdebug-ai:test\tUp\n",error_code:null};
      if(command==="docker"&&args[0]==="exec"){auditCalls++;return{ok:true,status:0,stdout:sourceProbeOutput(),error_code:null};}
      throw new Error(`UNEXPECTED:${command}:${args.join(" ")}`);
    };
    const out=await collectReadback({cwd:f.root,runner,health:async()=>({reachable:true,status_code:200,ok:true,service:"debug-ai",error_code:null})});
    assert.equal(out.git.repository_identity,"github.com/other/debug-ai");
    assert.equal(out.git.repository_identity_match,false);
    assert.equal(out.checkout_source_proven,false);
    assert.equal(out.search_shadow_measurement_authorized,false);
    assert.equal(out.search_shadow_measurement_executed,false);
    assert.equal(auditCalls,1);
  }finally{f.cleanup();}
});

test("measurement authorization gates and executes the read-only live shadow audit",async()=>{
  const f=tempRepo();
  try{
    makeCompatibleCheckout(f.root);
    const git=baseGitResult({root:f.root});
    let auditCalls=0;
    const runner=(command,args)=>{
      const result=git(command,args);if(result)return result;
      if(command==="docker"&&args[0]==="ps")return{ok:true,status:0,stdout:"abc123\tdebug-ai\tdebug-ai:test\tUp 1 minute (healthy)\n",error_code:null};
      if(command==="docker"&&args[0]==="exec"&&args[3]==="-e")return{ok:true,status:0,stdout:sourceProbeOutput(),error_code:null};
      if(command==="docker"&&args[0]==="exec"&&args[3]==="/app/scripts/search-gate-shadow-audit.cjs"){
        auditCalls++;
        assert.deepEqual(args.slice(4),["--runtime-root","/app/runtime","--max-managed-records","10000"]);
        return{ok:true,status:0,stdout:auditOutput(),error_code:null};
      }
      throw new Error(`UNEXPECTED:${command}:${args.join(" ")}`);
    };
    const healthy=async()=>({reachable:true,status_code:200,ok:true,service:"debug-ai",error_code:null});
    const out=await collectReadback({cwd:f.root,runner,health:healthy});
    assert.equal(out.schema,"debugai.live-runtime-readback/v2");
    assert.equal(out.checkout_source_proven,true);
    assert.equal(out.runtime_source_state,"RUNNING_CONTAINER_SOURCE_COMPATIBLE");
    assert.equal(out.search_shadow_measurement_authorized,true);
    assert.equal(out.search_shadow_measurement_executed,true);
    assert.equal(out.search_shadow_measurement_pass,true);
    assert.equal(out.shadow_audit.window_status,"NO_CANDIDATE_OBSERVATIONS");
    assert.equal(out.shadow_audit.false_skip_assessment,"NOT_EVALUABLE");
    assert.equal(out.search_skip_activation_authorized,false);
    assert.equal(auditCalls,1);
    assert.equal(healthOk({reachable:true,status_code:200,ok:true,service:"other"}),false);
    assert.equal(healthOk({reachable:true,status_code:503,ok:true,service:"debug-ai"}),false);
    assert.equal(healthOk({reachable:true,status_code:200,ok:false,service:"debug-ai"}),false);
    const wrongService=await collectReadback({cwd:f.root,runner,health:async()=>({reachable:true,status_code:200,ok:true,service:"other",error_code:null})});
    assert.equal(wrongService.search_shadow_measurement_authorized,false);
    assert.equal(wrongService.search_shadow_measurement_executed,false);
    assert.equal(auditCalls,1);
  }finally{f.cleanup();}
});

test("invalid live shadow audit output fails closed without ever authorizing activation",async()=>{
  const f=tempRepo();
  try{
    makeCompatibleCheckout(f.root);
    const git=baseGitResult({root:f.root});
    const runner=(command,args)=>{
      const result=git(command,args);if(result)return result;
      if(command==="docker"&&args[0]==="ps")return{ok:true,status:0,stdout:"abc123\tdebug-ai\tdebug-ai:test\tUp\n",error_code:null};
      if(command==="docker"&&args[0]==="exec"&&args[3]==="-e")return{ok:true,status:0,stdout:sourceProbeOutput(),error_code:null};
      if(command==="docker"&&args[0]==="exec")return{ok:true,status:0,stdout:auditOutput({activation_authorized:true}),error_code:null};
      throw new Error(`UNEXPECTED:${command}:${args.join(" ")}`);
    };
    const out=await collectReadback({cwd:f.root,runner,health:async()=>({reachable:true,status_code:200,ok:true,service:"debug-ai",error_code:null})});
    assert.equal(out.search_shadow_measurement_authorized,true);
    assert.equal(out.search_shadow_measurement_executed,true);
    assert.equal(out.search_shadow_measurement_pass,false);
    assert.equal(out.shadow_audit,null);
    assert.equal(out.shadow_audit_error_code,"SHADOW_AUDIT_RESULT_INVALID");
    assert.equal(out.search_skip_activation_authorized,false);
  }finally{f.cleanup();}
});
