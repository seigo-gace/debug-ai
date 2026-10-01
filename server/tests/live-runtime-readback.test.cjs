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
  gitReadback,
  sourceReadback,
  dockerReadback,
  containerSourceReadback,
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

test("live readback redacts HTTPS remote credentials",()=>{
  assert.equal(sanitizeRemote("https://secret-token@github.com/seigo-gace/debug-ai.git\n"),"https://***@github.com/seigo-gace/debug-ai.git");
  assert.equal(sanitizeRemote("git@github.com:seigo-gace/debug-ai.git"),"git@github.com:seigo-gace/debug-ai.git");
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

test("running container source proof requires exactly one container and all shadow modules",()=>{
  const docker={available:true,container_count:1,containers:[{id:"abc123",name:"debug-ai",image:"debug-ai:test",status:"Up"}],error_code:null};
  const runner=(command,args)=>{
    assert.equal(command,"docker");
    assert.equal(args[0],"exec");
    assert.equal(args[1],"abc123");
    const required_files=Object.fromEntries(CONTAINER_SOURCE_REQUIREMENTS.map(p=>[p,true]));
    return{ok:true,status:0,stdout:JSON.stringify({required_files,candidate_policy_version:"debugai.search-gate-candidate-policy/v1",shadow_runtime_policy_version:"debugai.search-gate-shadow-runtime/v2"}),error_code:null};
  };
  const out=containerSourceReadback(docker,runner);
  assert.equal(out.checked,true);
  assert.equal(out.compatible,true);
  assert.equal(out.reason,"SOURCE_COMPATIBLE");
  assert.equal(containerSourceReadback({...docker,container_count:2,containers:[docker.containers[0],docker.containers[0]]},runner).compatible,false);
});

test("combined live readback never authorizes search skip and fails closed on incompatible source",async()=>{
  const f=tempRepo();
  try{
    write(f.root,"package.json",JSON.stringify({scripts:{}}));
    const runner=(command,args)=>{
      const key=args.join(" ");
      if(command==="git"&&key==="rev-parse --show-toplevel")return{ok:true,status:0,stdout:f.root+"\n",error_code:null};
      if(command==="git"&&key==="config --get remote.origin.url")return{ok:true,status:0,stdout:"git@github.com:seigo-gace/debug-ai.git\n",error_code:null};
      if(command==="git"&&key==="branch --show-current")return{ok:true,status:0,stdout:"main\n",error_code:null};
      if(command==="git"&&key==="rev-parse HEAD")return{ok:true,status:0,stdout:"b".repeat(40)+"\n",error_code:null};
      if(command==="git"&&key.startsWith("diff "))return{ok:true,status:0,stdout:"",error_code:null};
      const rel=command==="git"?trackedProbePath(args):null;
      if(rel&&SOURCE_REQUIREMENTS.includes(rel))return{ok:false,status:1,stdout:"",error_code:null};
      if(command==="docker")return{ok:true,status:0,stdout:"",error_code:null};
      throw new Error(`UNEXPECTED:${command}:${key}`);
    };
    const health=async()=>({reachable:true,status_code:200,error_code:null});
    const out=await collectReadback({cwd:f.root,runner,health});
    assert.equal(out.read_only,true);
    assert.equal(out.mutation_attempted,false);
    assert.equal(out.checkout_source_proven,false);
    assert.equal(out.runtime_source_state,"RUNTIME_SOURCE_BEHIND_OR_UNKNOWN");
    assert.equal(out.search_shadow_measurement_authorized,false);
    assert.equal(out.search_skip_activation_authorized,false);
  }finally{f.cleanup();}
});

test("measurement authorization needs compatible checkout, compatible running container and healthy loopback",async()=>{
  const f=tempRepo();
  try{
    makeCompatibleCheckout(f.root);
    const required_files=Object.fromEntries(CONTAINER_SOURCE_REQUIREMENTS.map(p=>[p,true]));
    const runner=(command,args)=>{
      const key=args.join(" ");
      if(command==="git"&&key==="rev-parse --show-toplevel")return{ok:true,status:0,stdout:f.root+"\n",error_code:null};
      if(command==="git"&&key==="config --get remote.origin.url")return{ok:true,status:0,stdout:"git@github.com:seigo-gace/debug-ai.git\n",error_code:null};
      if(command==="git"&&key==="branch --show-current")return{ok:true,status:0,stdout:"feat/runtime\n",error_code:null};
      if(command==="git"&&key==="rev-parse HEAD")return{ok:true,status:0,stdout:"c".repeat(40)+"\n",error_code:null};
      if(command==="git"&&key.startsWith("diff "))return{ok:true,status:0,stdout:"",error_code:null};
      const rel=command==="git"?trackedProbePath(args):null;
      if(rel&&SOURCE_REQUIREMENTS.includes(rel))return{ok:true,status:0,stdout:`${rel}\n`,error_code:null};
      if(command==="docker"&&args[0]==="ps")return{ok:true,status:0,stdout:"abc123\tdebug-ai\tdebug-ai:test\tUp 1 minute (healthy)\n",error_code:null};
      if(command==="docker"&&args[0]==="exec")return{ok:true,status:0,stdout:JSON.stringify({required_files,candidate_policy_version:"debugai.search-gate-candidate-policy/v1",shadow_runtime_policy_version:"debugai.search-gate-shadow-runtime/v2"}),error_code:null};
      throw new Error(`UNEXPECTED:${command}:${key}`);
    };
    const healthy=async()=>({reachable:true,status_code:200,error_code:null});
    const out=await collectReadback({cwd:f.root,runner,health:healthy});
    assert.equal(out.checkout_source_proven,true);
    assert.equal(out.runtime_source_state,"RUNNING_CONTAINER_SOURCE_COMPATIBLE");
    assert.equal(out.search_shadow_measurement_authorized,true);
    assert.equal(out.search_skip_activation_authorized,false);
    const unhealthy=await collectReadback({cwd:f.root,runner,health:async()=>({reachable:true,status_code:503,error_code:null})});
    assert.equal(unhealthy.search_shadow_measurement_authorized,false);
  }finally{f.cleanup();}
});
