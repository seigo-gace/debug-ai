"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {makeEvidenceRecord}=require("../control/evidence-registry.js");
const {createRoleProgressEvaluator}=require("../control/role-output-validator.js");
const {setup,examples}=require("./fixtures/g3-semantic-cases.cjs");
for(const role of Object.keys(examples)){
 test(`${role}: reject churn, paraphrase, missing evidence and unsupported COMPLETE`,()=>{
  const {evaluator,record,marker,e}=setup(role);
  assert.throws(()=>evaluator.qualifyProgress({progress:{evidence_refs:[record.evidence_id],remaining_work:"done differently"},previousProgress:{}}),/NO_SEMANTIC_PROGRESS/);
  const first=evaluator.qualifyProgress({progress:{verified_work:[marker],remaining_work:[]},previousProgress:{}});
  assert.equal(first.qualification.total_qualified_progress_ids,1);
  assert.throws(()=>evaluator.qualifyProgress({progress:{...first,summary:"paraphrase"},previousProgress:first}),/NO_SEMANTIC_PROGRESS/);
  assert.throws(()=>evaluator.qualifyProgress({progress:{verified_work:[{...marker,evidence_refs:["EVI_new"]}],remaining_work:[]},previousProgress:{}}),/EVIDENCE/);
  assert.equal(evaluator.validateCompletion({result:e.result,previousProgress:first}),false);
  const result={...e.result,verified_work:[marker]};
  assert.equal(evaluator.validateCompletion({result,previousProgress:first}),true);
  assert.equal(evaluator.validateCompletion({result:{...result,applied:true},previousProgress:first}),false);
 });
}
module.exports={setup,examples};

const {createWorkflow}=require("../workflow.js");
function authority(){
 let manifest={workflow_input_refs:{}};const records=new Map();
 return {durableEnabled:()=>true,loadDurable:()=>({manifest:structuredClone(manifest)}),readDurableRecord:p=>structuredClone(records.get(p)),
 async commitDurable({manifestPatch,immutableRecords}){for(const {path,record} of immutableRecords){assert.equal(records.has(path),false);records.set(path,structuredClone(record));}manifest={workflow_input_refs:{...manifest.workflow_input_refs,...manifestPatch.workflow_input_refs}};},records};
}
for(const role of Object.keys(examples)){
 test(`${role}: actual workflow resumes validated progress; completion replay calls zero models`,async()=>{
  const {criteria,record,marker,e}=setup(role),auth=authority();let calls=0;
  const args={runId:"run",role,workItemId:"bound",task:"verify the fixed obligation",inputBinding:"source1",semanticCriteria:criteria,evidenceRecords:[record]};
  const aiCore={call:async()=>{calls++;if(calls===1)return{content:JSON.stringify({status:"CONTINUE",progress:{verified_work:[marker],remaining_work:[]}})};return{content:JSON.stringify({status:"COMPLETE",result:{...e.result,verified_work:[marker]}})};}};
  const first=await createWorkflow({authority:auth,aiCore}).continueRoleTask(args);
  assert.equal(first.status,"CONTINUE");assert.equal(first.progress.qualification.total_qualified_progress_ids,1);
  // Fresh workflow/evaluator instances must derive decisions from committed state.
  const wf=createWorkflow({authority:auth,aiCore});
  await assert.rejects(wf.continueRoleTask({...args,semanticCriteria:null}),/INPUT_BINDING_MISMATCH/);
  await assert.rejects(wf.continueRoleTask({...args,semanticCriteria:criteria.map(c=>({...c,id:"changed"}))}),/INPUT_BINDING_MISMATCH/);
  assert.equal((await wf.continueRoleTask(args)).status,"COMPLETE");
  const before=calls;assert.equal((await createWorkflow({authority:auth,aiCore}).continueRoleTask(args)).status,"COMPLETE");assert.equal(calls,before);
 });
 test(`${role}: valid shape with unsupported COMPLETE does not commit`,async()=>{
  const {criteria,record,e}=setup(role),auth=authority();
  const wf=createWorkflow({authority:auth,aiCore:{call:async()=>({content:JSON.stringify({status:"COMPLETE",result:e.result})})}});
  await assert.rejects(wf.continueRoleTask({runId:"r",role,workItemId:"a",task:"fixed",inputBinding:"x",semanticCriteria:criteria,evidenceRecords:[record]}),/MODEL_FINAL_REJECTED/);
  assert.equal(auth.records.size,0);
 });
}
test("independent holdouts: forged record, duplicate semantics, false remaining work and mutated oracle",()=>{
 const {criteria,record,marker,evaluator}=setup("code_scout");
 assert.throws(()=>createRoleProgressEvaluator({role:"code_scout",criteria,evidenceRecords:[{...record,payload:{...record.payload,path:"other.js"}}]}),/HASH_MISMATCH/);
 assert.throws(()=>createRoleProgressEvaluator({role:"code_scout",criteria:[...criteria,{...criteria[0],id:"another-id"}],evidenceRecords:[record]}),/DUPLICATE_OBJECTIVE/);
 assert.throws(()=>evaluator.qualifyProgress({progress:{verified_work:[marker],remaining_work:["invented"]}}),/REMAINING_MISMATCH/);
 criteria[0].observation.path="mutated.js";record.payload.path="mutated.js";
 assert.equal(evaluator.qualifyProgress({progress:{verified_work:[marker],remaining_work:[]}}).qualification.total_qualified_progress_ids,1);
});
test("G3 requested without an independent task oracle refuses before inference",async()=>{
 const wf=createWorkflow({authority:authority(),aiCore:{call:async()=>{throw Error("MUST_NOT_CALL");}},recoveryHooks:{requireSemanticProgress:true}});
 await assert.rejects(wf.continueRoleTask({runId:"r",role:"code_scout",workItemId:"a",task:"fixed",inputBinding:"x"}),/CRITERIA_REQUIRED/);
 await assert.rejects(wf.continueDiagnoserTask({runId:"r",workItemId:"a",task:"fixed",inputBinding:"x"}),/CRITERIA_REQUIRED/);
});

test("all six roles: independent native processes restore exact progress and terminal decisions",()=>{
 const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{spawnSync}=require("node:child_process");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"g3-native-"));
 try{
  const run=mode=>{const out=spawnSync(process.execPath,[path.join(__dirname,"fixtures/g3-process-child.cjs"),root,mode],{encoding:"utf8",timeout:20000});assert.equal(out.status,0,out.stderr);return JSON.parse(out.stdout);};
  const initial=run("initial"),resumed=run("resume"),replay=run("replay");
  assert.equal(initial.calls,6);assert.equal(resumed.calls,6);assert.equal(replay.calls,0);
  assert.equal(initial.runId,resumed.runId);assert.equal(resumed.runId,replay.runId);
  assert.ok(initial.stages.every(s=>s.status==="CONTINUE"&&s.qualified===1));
  assert.ok(resumed.stages.every(s=>s.status==="COMPLETE"&&s.revision===2&&s.qualified===1));
  assert.deepEqual(replay.stages,resumed.stages);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
for(const role of Object.keys(examples))test(`${role}: independently registered but unrelated evidence fails task matching`,()=>{
 const {criteria,record,marker}=setup(role);
 const unrelated=makeEvidenceRecord("LOCAL_RUNTIME",{...record.payload,kind:"unrelated",observation:"valid new ID"},{sourceRef:record.source_ref});
 const changed=criteria.map(c=>({...c,evidence_id:unrelated.evidence_id,result:JSON.parse(JSON.stringify(c.result).split(record.evidence_id).join(unrelated.evidence_id))}));
 const evaluator=createRoleProgressEvaluator({role,criteria:changed,evidenceRecords:[unrelated]});
 assert.throws(()=>evaluator.qualifyProgress({progress:{verified_work:[{...marker,evidence_refs:[unrelated.evidence_id]}],remaining_work:[]}}),/EVIDENCE_MISMATCH/);
});

const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");
const {makeToolResult,readText}=require("../control/read-only-tool-runtime.js");
test("real owning source inspection qualifies only the fixed source hash and committed receipt",async()=>{
 const path=require("node:path"),root=path.join(__dirname,"../.."),source=readText(root,"server/control/progress-controller.js",{maxChars:20000});
 const record=makeEvidenceRecord("LOCAL_RUNTIME",{kind:"source_inspection",path:source.path,sha256:source.sha256},{sourceRef:"owned-source-check"});
 const canonical={relevant_files:[source.path],call_path:[],excluded_files:[],unknowns:[],contract_mismatch:null};
 const criteria=[{id:"read-controller",kind:"source_inspection",evidence_id:record.evidence_id,source_ref:record.source_ref,observation:{path:source.path,sha256:source.sha256},result:canonical}];
 let round=0;
 const execute=()=>runRoleWithReadOnlyTools({role:"code_scout",user:"Inspect the progress controller",baseEvidenceIds:[record.evidence_id],strictEvidenceRefs:true,
  aiCore:{call:async()=>({content:JSON.stringify(++round===1?{tool_requests:[{tool:"source.read",arguments:{path:source.path}}]}:{...canonical,verified_work:[{criterion_id:"read-controller",evidence_refs:[record.evidence_id]}]})})},
  toolRuntime:{availableTools:["source.read"],execute:async()=>makeToolResult("source.read",readText(root,source.path,{maxChars:20000}))},
  durableHooks:{onToolResult:async()=>({effect_id:"committed-read-receipt"})},
  progressQualification:createRoleProgressEvaluator({role:"code_scout",criteria,evidenceRecords:[record]}).toolQualification});
 const out=await execute();assert.equal(out.tool_loop.progress.history[0].progress_delta,1);assert.equal(out.tool_loop.progress.total_qualified_progress_ids,1);
 const state=out.tool_loop.continuation_state;
 const resumed=await runRoleWithReadOnlyTools({role:"code_scout",user:"same",baseEvidenceIds:[record.evidence_id],strictEvidenceRefs:true,continuationState:state,
  aiCore:{call:async()=>({content:JSON.stringify({...canonical,verified_work:[{criterion_id:"read-controller",evidence_refs:[record.evidence_id]}]})})},
  toolRuntime:{availableTools:["source.read"],execute:async()=>{throw Error("READ_REPLAY_FORBIDDEN");}},
  progressQualification:createRoleProgressEvaluator({role:"code_scout",criteria,evidenceRecords:[record]}).toolQualification});
 assert.equal(resumed.tool_loop.progress.total_qualified_progress_ids,1);
 const changed=createRoleProgressEvaluator({role:"code_scout",criteria:criteria.map(c=>({...c,id:"other-task"})),evidenceRecords:[record]});
 await assert.rejects(runRoleWithReadOnlyTools({role:"code_scout",continuationState:state,toolRuntime:{availableTools:["source.read"]},aiCore:{call:async()=>{throw Error("MUST_NOT_CALL");}},progressQualification:changed.toolQualification}),/BINDING_MISMATCH/);
});
for(const role of Object.keys(examples))test(`${role}: Tool Loop final gate rejects unsupported role output`,async()=>{
 const {criteria,record,e}=setup(role);
 await assert.rejects(runRoleWithReadOnlyTools({role,user:"fixed",baseEvidenceIds:[record.evidence_id],strictEvidenceRefs:true,
  aiCore:{call:async()=>({content:JSON.stringify(e.result)})},
  progressQualification:createRoleProgressEvaluator({role,criteria,evidenceRecords:[record]}).toolQualification}),/COMPLETION_NOT_QUALIFIED/);
});

test("expected role answers stay independent of the model prompt",async()=>{
 const {criteria,record,marker}=setup("researcher");let prompt;
 const wf=createWorkflow({authority:authority(),aiCore:{call:async(_role,p)=>{prompt=p;return{content:JSON.stringify({status:"CONTINUE",progress:{verified_work:[marker],remaining_work:[]}})};}}});
 await wf.continueRoleTask({runId:"r",role:"researcher",workItemId:"a",task:"source qualification",inputBinding:"v1",semanticCriteria:criteria,evidenceRecords:[record]});
 const input=JSON.parse(prompt.user);
 assert.equal(input.criteria[0].result,undefined);assert.equal(input.criteria[0].observation,undefined);assert.equal(input.criteria[0].objective,undefined);
 assert.equal(prompt.user.includes(criteria[0].result.answer),false);
});
test("tool objectives refuse an uncommitted result and a mismatched source hash",()=>{
 const {evaluator,criteria}=setup("code_scout"),result=makeToolResult("source.read",{...criteria[0].observation,content:"actual source"});
 assert.deepEqual(evaluator.toolQualification.qualifyResult({result}),[]);
 assert.deepEqual(evaluator.toolQualification.qualifyResult({result:makeToolResult("source.read",{...result.data,sha256:"c".repeat(64)}),effectId:"receipt"}),[]);
 const ids=evaluator.toolQualification.qualifyResult({result,effectId:"receipt"});assert.equal(ids.length,1);
 assert.equal(evaluator.toolQualification.verify({id:ids[0],roleEvidenceIds:[result.evidence_id],completedEffectIds:[]}),false);
});
