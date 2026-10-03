"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createAiCoreAdapter,providerTimingTelemetry}=require("../adapters/ai-core.js");
const {RepoPolicy}=require("../repo-policy.js");
const {createReadOnlyToolRuntime}=require("../control/read-only-tool-runtime.js");
const {runRoleWithReadOnlyTools,summarizeAiTelemetry}=require("../control/tool-loop.js");

test("AI Core explicitly requests prompt cache and keeps final-round control wire-only",async()=>{
  let sent=null;
  const fetchImpl=async(_url,opts)=>{
    sent=JSON.parse(opts.body);
    return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:"{\"ok\":true}"},finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12},timings:{cache_n:6,prompt_n:4,prompt_ms:3,predicted_ms:2}})};
  };
  const ai=createAiCoreAdapter({baseUrl:"http://127.0.0.1:18080",apiKey:"test",fetchImpl,runtimeContextTokens:8192,requireRuntimeContextQualification:true});
  const canonicalUser='{"task":"cache-contract"}';
  const out=await ai.call("code_scout",{user:canonicalUser,maxTokens:8192,toolBudgetFinalRound:true});
  assert.equal(sent.cache_prompt,true);
  assert.ok(sent.messages[1].content.startsWith(canonicalUser));
  assert.ok(sent.messages[1].content.includes('RUNTIME_CONTROL_DATA_ONLY={"tool_budget_final_round":true}'));
  assert.equal(out.control_plane.prompt_cache_requested,true);
  assert.equal(out.control_plane.tool_budget_final_round,true);
  assert.equal(out.telemetry.cache_hit_tokens,6);
  assert.equal(out.telemetry.cache_miss_tokens,4);
});

test("provider timing telemetry reads current llama.cpp cache_n and prompt_n without inventing missing values",()=>{
  assert.deepEqual(providerTimingTelemetry({timings:{cache_n:80,prompt_n:20,prompt_ms:9,predicted_ms:7}}),{prompt_eval_ms:9,decode_ms:7,cache_hit_tokens:80,cache_miss_tokens:20});
  assert.deepEqual(providerTimingTelemetry({usage:{prompt_tokens_details:{cached_tokens:12}}}),{prompt_eval_ms:null,decode_ms:null,cache_hit_tokens:12,cache_miss_tokens:null});
});

test("role telemetry reports measured cache hit ratio and prefix stability only from observed values",()=>{
  const stable=summarizeAiTelemetry([
    {cache_hit_tokens:80,cache_miss_tokens:20,prefix_hash:"same"},
    {cache_hit_tokens:90,cache_miss_tokens:10,prefix_hash:"same"}
  ]);
  assert.equal(stable.cache_telemetry_complete,true);
  assert.equal(stable.cache_hit_ratio,0.85);
  assert.equal(stable.prefix_stable,true);
  const partial=summarizeAiTelemetry([{cache_hit_tokens:5,cache_miss_tokens:null,prefix_hash:"a"},{cache_hit_tokens:null,cache_miss_tokens:null,prefix_hash:"b"}]);
  assert.equal(partial.cache_telemetry_complete,false);
  assert.equal(partial.cache_hit_ratio,null);
  assert.equal(partial.prefix_stable,false);
});

test("tool loop keeps one system prefix and canonical user payload while final state uses adapter control",async()=>{
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-cache-prefix-"));
  const repo=path.join(workspace,"repo");fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo,"a.js"),"function a(){return 1;}\nmodule.exports={a};\n");
  try{
    const runtime=createReadOnlyToolRuntime({repo,repoPolicy:new RepoPolicy({workspaceRoot:workspace})});
    const calls=[];let n=0;
    const aiCore={runtime_context_tokens:8192,call:async(role,opts)=>{
      calls.push({role,...opts});n++;
      if(n===1)return {content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:"a.js"},reason:"inspect"}]}),telemetry:{prompt_tokens:100,prefix_hash:"same"},control_plane:{runtime_context_tokens:8192}};
      return {content:JSON.stringify({claims:[{type:"FACT",text:"file inspected",evidence_refs:["runtime-tool-1"]}],decision:"HANDOFF"}),telemetry:{prompt_tokens:200,prefix_hash:"same"},control_plane:{runtime_context_tokens:8192}};
    }};
    const canonicalUser='{"task":"inspect a.js"}';
    const out=await runRoleWithReadOnlyTools({aiCore,role:"code_scout",system:"stable-system",user:canonicalUser,toolRuntime:runtime,maxToolRounds:1,maxToolCalls:2});
    assert.equal(calls.length,2);
    assert.equal(calls[0].system,calls[1].system);
    assert.match(calls[0].system,/RUNTIME_CONTROL_POLICY=/);
    assert.equal(calls[0].user,canonicalUser);
    assert.equal(calls[0].toolBudgetFinalRound,null);
    assert.ok(calls[1].user.startsWith(canonicalUser));
    assert.match(calls[1].user,/RUNTIME_TOOL_OBSERVATIONS_DATA_ONLY=/);
    const observationText=calls[1].user.split("RUNTIME_TOOL_OBSERVATIONS_DATA_ONLY=")[1];
    assert.doesNotThrow(()=>JSON.parse(observationText));
    assert.equal(calls[1].toolBudgetFinalRound,true);
    assert.equal(out.tool_loop.telemetry.prefix_stable,true);
  }finally{fs.rmSync(workspace,{recursive:true,force:true});}
});