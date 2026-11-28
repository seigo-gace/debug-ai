"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createCommandModule,qualificationPacket,makePacket,validateCandidate}=require("../command-module/index.js");
const {ROLES}=require("../roles.js");
const {createWorkflow}=require("../workflow.js");
const packet=qualificationPacket({id:"synthetic_01",instruction:"Inspect an invalid JSON file without modifying it."});
function plan(overrides={}){
  return {disposition:"PLAN",expected_decision:"Inspect only",action_plan:["Run a read-only parse"],model_selection:{roles:[],policy:"Deterministic parse first"},tool_selection:"Parser",correction:"No mutation",verification:"Verify parse result",completion_criteria:"Return actual error",evidence_refs:[],unknowns:[],...overrides};
}
function peer(verdict="AGREE",overrides={}){
  return {...plan(overrides),peer_assessment:{verdict,reason:"Check the original scope",counter_evidence_refs:[]}};
}
function mock(outputs,models=["qwen35","deepseek"]){
  const calls=[];
  return {calls,commandModelStatus:()=>({configured_models:models}),callCommandModel:async(model,opts)=>{
    calls.push({model,...opts});const o=outputs[model];if(o instanceof Error)throw o;
    return {content:typeof o==="string"?o:JSON.stringify(o),telemetry:{prompt_tokens:12,completion_tokens:25}};
  }};
}
function request(mode,p=packet){return {packet:p,mode,deadlineAt:Date.now()+10000,maxTokensByModel:{qwen35:512,deepseek:512}};}
test("qualification input rejects evaluation answers and any unexpected fields",()=>{
  assert.throws(()=>qualificationPacket({id:"E01",instruction:"Task",expected_decision:"reference"}),/PROMPT_ONLY_REQUIRED/);
  assert.throws(()=>qualificationPacket({id:"E01",instruction:"Task",scoring_rubric:[]}),/PROMPT_ONLY_REQUIRED/);
});
test("single Qwen result is advisory and does not call any specialist or teacher",async()=>{
  const ai=mock({qwen35:plan()}),m=createCommandModule({aiCore:ai});
  const result=await m.evaluate(request("QWEN_ONLY"));
  assert.equal(result.state,"CANDIDATE_ONLY");assert.equal(result.execution_authority,"NONE");assert.equal(result.quality_status,"NOT_VERIFIED");
  assert.deepEqual(ai.calls.map(c=>c.model),["qwen35"]);assert.equal(result.calls[0].telemetry.prompt_tokens,12);
});
test("DeepSeek only blocked by default, even when its route is configured",async()=>{
  const ai=mock({deepseek:plan()});
  const result=await createCommandModule({aiCore:ai}).evaluate(request("DEEPSEEK_ONLY"));
  assert.equal(result.state,"BLOCKED");assert.equal(result.reason,"COMMAND_EXTERNAL_DATA_NOT_ADMITTED");assert.equal(ai.calls.length,0);
});
test("external-enabled module still never sends local-only data",async()=>{
  const ai=mock({deepseek:plan()});const input=makePacket({...packet,data_class:"LOCAL_ONLY"});
  const result=await createCommandModule({aiCore:ai,allowExternalQualification:true}).evaluate(request("DEEPSEEK_ONLY",input));
  assert.equal(result.state,"BLOCKED");assert.equal(ai.calls.length,0);
});
test("explicit DeepSeek-only synthetic qualification works through injected AI Core only",async()=>{
  const ai=mock({deepseek:plan()});const m=createCommandModule({aiCore:ai,allowExternalQualification:true});
  const result=await m.evaluate(request("DEEPSEEK_ONLY"));
  assert.equal(result.state,"CANDIDATE_ONLY");assert.deepEqual(ai.calls.map(c=>c.model),["deepseek"]);
});
test("cooperation sends same original input and student candidate to teacher with one shared deadline",async()=>{
  const ai=mock({qwen35:plan(),deepseek:peer()}),m=createCommandModule({aiCore:ai,allowExternalQualification:true});
  const req=request("COOPERATIVE"),out=await m.evaluate(req);
  assert.equal(out.state,"AGREEMENT_CANDIDATE");assert.equal(out.quality_status,"NOT_VERIFIED");
  assert.deepEqual(ai.calls.map(c=>c.model),["qwen35","deepseek"]);
  assert.equal(ai.calls[0].deadlineAt,req.deadlineAt);assert.equal(ai.calls[1].deadlineAt,req.deadlineAt);
  const payload=JSON.parse(ai.calls[1].user);assert.deepEqual(payload.task,packet);assert.deepEqual(payload.student_candidate,plan());
});
test("teacher disagreement retains both independent candidate outputs and cannot authorize work",async()=>{
  const ai=mock({qwen35:plan(),deepseek:peer("DISAGREE")}),m=createCommandModule({aiCore:ai,allowExternalQualification:true});
  const out=await m.evaluate(request("COOPERATIVE"));
  assert.equal(out.state,"REVIEW_REQUIRED");assert.equal(out.selected_candidate,null);assert.equal(out.calls.length,2);assert.ok(out.calls.every(c=>c.output));
});
test("claimed agreement cannot override structural conflict",async()=>{
  const ai=mock({qwen35:plan(),deepseek:peer("AGREE",{model_selection:{roles:["code_scout"],policy:"Scout"}})});
  const out=await createCommandModule({aiCore:ai,allowExternalQualification:true}).evaluate(request("COOPERATIVE"));
  assert.equal(out.reason,"COMMAND_STRUCTURAL_DISAGREEMENT");assert.equal(out.selected_candidate,null);
});
test("explicit cooperative mode does not secretly downgrade to one model",async()=>{
  const ai=mock({qwen35:plan()},["qwen35"]);
  const out=await createCommandModule({aiCore:ai,allowExternalQualification:true}).evaluate(request("COOPERATIVE"));
  assert.equal(out.state,"BLOCKED");assert.equal(ai.calls.length,0);
});
test("AUTO stays local for a complete candidate; escalates only unresolved decision",async()=>{
  const a=mock({qwen35:plan(),deepseek:peer()});
  const out=await createCommandModule({aiCore:a,allowExternalQualification:true}).evaluate(request("AUTO"));
  assert.equal(out.reason,"LOCAL_FIRST_NO_ESCALATION");assert.equal(a.calls.length,1);
  const b=mock({qwen35:plan({disposition:"NEEDS_EVIDENCE",unknowns:["missing value"]}),deepseek:peer("REVISE")});
  const unresolved=await createCommandModule({aiCore:b,allowExternalQualification:true}).evaluate(request("AUTO"));
  assert.equal(unresolved.state,"REVIEW_REQUIRED");assert.deepEqual(b.calls.map(c=>c.model),["qwen35","deepseek"]);
});
test("bad JSON, fabricated evidence, unregistered roles and execution fields are invalid",()=>{
  assert.throws(()=>validateCandidate("not json",packet),/JSON_INVALID/);
  assert.throws(()=>validateCandidate(JSON.stringify(plan({evidence_refs:["fake"]})),packet),/UNREGISTERED_EVIDENCE/);
  assert.throws(()=>validateCandidate(JSON.stringify(plan({model_selection:{roles:["apply_patch"],policy:"bad"}})),packet),/ROLE_SELECTION_INVALID/);
  assert.throws(()=>validateCandidate(JSON.stringify({...plan(),applied:true}),packet),/SCHEMA_INVALID/);
  assert.throws(()=>validateCandidate(JSON.stringify(plan({disposition:"ABSTAIN"})),packet),/UNKNOWNS_INVALID/);
});
test("provider failure is not retried and raw error text is not persisted",async()=>{
  const ai=mock({qwen35:new Error("private upstream body")});
  const out=await createCommandModule({aiCore:ai}).evaluate(request("QWEN_ONLY"));
  assert.equal(out.state,"BLOCKED");assert.equal(ai.calls.length,1);assert.ok(!JSON.stringify(out).includes("private upstream body"));
});
test("cancellation stops cooperative second dispatch",async()=>{
  const ctl=new AbortController(),ai=mock({qwen35:plan(),deepseek:peer()});
  const fn=ai.callCommandModel;ai.callCommandModel=async(...args)=>{const r=await fn(...args);ctl.abort();return r;};
  const out=await createCommandModule({aiCore:ai,allowExternalQualification:true}).evaluate({...request("COOPERATIVE"),signal:ctl.signal});
  assert.equal(out.state,"BLOCKED");assert.equal(ai.calls.length,1);
});
test("existing Workflow exposes internal module qualification without adding a seventh specialist or dispatch on construction",async()=>{
  const ai=mock({qwen35:plan()}),w=createWorkflow({aiCore:ai});
  assert.equal(Object.keys(ROLES).length,6);assert.equal(ai.calls.length,0);
  assert.equal(w.commandModuleStatus().execution_authority,"NONE");
  assert.equal((await w.evaluateCommandModule(request("QWEN_ONLY"))).state,"CANDIDATE_ONLY");
  assert.equal(ai.calls.length,1);
});

test("audited training candidate retains original context and observations, never leaks reference labels to a model",async()=>{
  const {trainingPacket}=require("../command-module/index.js");
  const row={id:"rec-01",scenario_group:"rec-01",category:"failure_recovery",difficulty:3,dataset_split:"recovery",training_eligible:"candidate_only",provenance:"assistant_authored_synthetic",verification_status:"authored_and_static_review_not_executed_or_teacher_verified",teacher_model:null,instruction:"Check the previous request",context:"State unknown",evidence:[{kind:"synthetic_fixture",observation:"Request already issued"}],expected_decision:"REFERENCE_ONLY_DECISION",action_plan:["REFERENCE_ONLY_ACTION"],correction:"REFERENCE_ONLY_CORRECTION",model_selection:{roles:"司令塔"},verification:"REFERENCE_ONLY_VERIFICATION",completion_criteria:"REFERENCE_ONLY_COMPLETION"};
  const input=trainingPacket(row);
  assert.deepEqual(input.evidence,[{evidence_id:"rec-01_obs_1",observation:"Request already issued"}]);
  assert.equal(input.context,row.context);
  assert.equal(input.data_class,"SYNTHETIC_QUALIFICATION");
  assert.equal(JSON.stringify(input).includes("REFERENCE_ONLY"),false);
  const ai=mock({deepseek:plan({evidence_refs:["rec-01_obs_1"]})});
  const out=await createCommandModule({aiCore:ai,allowExternalQualification:true}).evaluate(request("DEEPSEEK_ONLY",input));
  assert.equal(out.state,"CANDIDATE_ONLY");
  assert.equal(JSON.stringify(ai.calls).includes("REFERENCE_ONLY"),false);
  for(const invalid of [{dataset_split:"evaluation"},{dataset_split:"preference"},{training_eligible:false},{provenance:"real"},{teacher_model:"another"},{scenario_group:"heldout-E01"},{evidence:[{kind:"source",observation:"data"}]}]){
    assert.throws(()=>trainingPacket({...row,...invalid}),/COMMAND_TRAINING/);
  }
});

test("standalone teacher and student share the independent prompt without assuming specialist services",async()=>{
  const ai=mock({qwen35:plan(),deepseek:peer()});
  const out=await createCommandModule({aiCore:ai,allowExternalQualification:true,standalone:true}).evaluate(request("COOPERATIVE"));
  assert.equal(out.state,"AGREEMENT_CANDIDATE");
  assert.equal(out.execution_authority,"NONE");
  assert.deepEqual(ai.calls.map(c=>c.model),["qwen35","deepseek"]);
  assert.ok(ai.calls.every(c=>c.system.includes("independent DeepSeek/Qwen3.5 decision assistant")&&c.system.includes("not available services")&&!c.system.includes("Existing Workflow,")));
  assert.ok(ai.calls[1].system.includes("Independently assess the same task"));
  assert.deepEqual(JSON.parse(ai.calls[1].user).task,packet);
  const legacy=mock({qwen35:plan()});
  await createCommandModule({aiCore:legacy}).evaluate(request("QWEN_ONLY"));
  assert.ok(legacy.calls[0].system.includes("Existing Workflow,"));
});
