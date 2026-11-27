"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const {localDiagnosisAdmission,acceptedLocalDiagnosisDispositions}=require("../control/role-disposition.js");
const {makeEvidenceRecord}=require("../control/evidence-registry.js");
const {createAiCoreAdapter}=require("../adapters/ai-core.js");
function fixture(){
 const check={kind:"deterministic_sandbox_check",check_type:"UNIT",executed:true,status:"FAIL",timed_out:false,exit_code:1,sandbox:{backend:"sidecar+landlock+seccomp",network:"CONTAINER_NETWORK_NONE",job_id:"job1"}};
 const record=(path,content)=>({kind:"initial_source",value:{path,content,truncated:false,sha256:createHash("sha256").update(content).digest("hex")}});
 const records=[record("src/a.cjs","module.exports=x=>x>0;"),record("reproduce.cjs","const assert=require('node:assert/strict');const f=require('./src/a.cjs');assert.equal(f(0),true);"),{kind:"initial_test_inventory",value:{checks:[{configured:true,name:"test",command:"node reproduce.cjs"}]}},check].map(v=>makeEvidenceRecord("LOCAL_RUNTIME",v));
 return {scope:{mode:"LOCAL_REPRODUCTION",unavailable:[]},failure:{source_paths:["src/a.cjs"],test_paths:["reproduce.cjs"],requirements:{requested_behavior:["Include zero"]}},records,checks:[check],repositoryRevision:"rev",inputDigest:"input",runId:"run"};
}
test("candidate binds source and reproduction, does not fake role completion",()=>{
 const a=localDiagnosisAdmission(fixture());assert.equal(a.eligible,true);assert.equal(a.evidence_refs.length,4);
 assert.ok(a.dispositions.every(d=>d.decision==="RUN"));assert.ok(acceptedLocalDiagnosisDispositions(a).every(d=>d.decision==="SATISFIED_BY_EVIDENCE"));
});
test("missing, corrupted, dynamic and timed out evidence cannot enter candidate",()=>{
 for(const change of [f=>f.scope.unavailable.push("missing"),f=>f.failure.test_paths=[],f=>f.checks[0].timed_out=true,f=>f.records.pop(),f=>{f.records[0]=makeEvidenceRecord("LOCAL_RUNTIME",{...f.records[0].payload,value:{...f.records[0].payload.value,content:"changed"}})}]){
  const f=fixture();change(f);assert.equal(localDiagnosisAdmission(f).eligible,false);
 }
 const f=fixture();f.records[0]={...f.records[0],payload:{kind:"forged"}};assert.throws(()=>localDiagnosisAdmission(f),/HASH_MISMATCH/);
});
test("non-thinking override is explicit, diagnoser-only, and not a default change",async()=>{
 const requests=[];const opts={baseUrl:"http://127.0.0.1:18080",apiKey:"test",maxTransportTimeoutAttempts:1,fetchImpl:async(_url,o)=>{requests.push(JSON.parse(o.body));return {ok:true,status:200,text:async()=>JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:"stop"}]})};}};
 const a=createAiCoreAdapter(opts);await a.call("diagnoser");assert.equal(requests.at(-1).chat_template_kwargs.enable_thinking,true);
 await assert.rejects(a.call("diagnoser",{thinkingOverride:false}),e=>e.code==="AI_CORE_THINKING_OVERRIDE_NOT_ADMITTED");
 const b=createAiCoreAdapter({...opts,adaptiveLocalDiagnosis:true});await b.call("diagnoser",{thinkingOverride:false});assert.equal(requests.at(-1).chat_template_kwargs.enable_thinking,false);
 await assert.rejects(b.call("causal_scout",{thinkingOverride:false}),e=>e.code==="AI_CORE_THINKING_OVERRIDE_NOT_ADMITTED");
});
