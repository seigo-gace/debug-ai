"use strict";
// Deterministic Tool Loop integration over real repo files, not a paid/model benchmark or actual causal E2E.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createReadOnlyToolRuntime,assertToolResultIntegrity}=require("../control/read-only-tool-runtime-base.js");
const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");
const {getSemanticShadow}=require("../control/role-output-validator.js");

function fixture(t){
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-handoff-"));
 t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
 fs.mkdirSync(path.join(repo,"src"));
 fs.writeFileSync(path.join(repo,"src","entry.js"),'const helper=require("./helper");\nmodule.exports=x=>helper.check(x);\n');
 fs.writeFileSync(path.join(repo,"src","helper.js"),"exports.check=x=>Boolean(x);\n");
 return {repo,runtime:createReadOnlyToolRuntime({repo,repoPolicy:{assertRepo:p=>p}})};
}
const scoutOutput=()=>({relevant_files:["src/entry.js","src/helper.js"],call_path:[],contract_mismatch:null,excluded_files:[],unknowns:["A real runtime failure and root cause have not been established"]});
const hypothesis=(refs,other=[])=>({diagnosis_status:"HYPOTHESES_RETAINED",hypotheses:[{id:"H_SOURCE_PATH",status:"HYPOTHESIS",evidence_refs:refs,counter_evidence_refs:other,falsification_condition:"Reproduce the input failure in an isolated runtime test"}],confirmed_root_cause:null,unsupported_claims:["The observed code path alone does not establish a root cause"]});

test("real Code Scout tools bind source candidates into Diagnoser evidence.read with stable admitted IDs",async t=>{
 const {runtime}=fixture(t),seen={scout:[],diagnoser:[]};let scoutTurn=0;
 const scoutAi={call:async (role,input)=>{
   assert.equal(role,"code_scout");seen.scout.push(input);
   return {content:JSON.stringify(scoutTurn++===0?{tool_requests:[
     {tool:"source.search",arguments:{query:"helper"},reason:"locate repository source"},
     {tool:"dependency.map",arguments:{path:"src/entry.js"},reason:"inspect bounded source imports"}
   ]}:scoutOutput())};
 }};
 const scout=await runRoleWithReadOnlyTools({aiCore:scoutAi,role:"code_scout",user:"Find actual repository source and bounded helper dependency behind the failing branch",toolRuntime:runtime,maxToolRounds:2,maxToolCalls:4,strictEvidenceRefs:true});
 assert.equal(scout.tool_loop.parse_status,"FINAL");
 assert.equal(scout.tool_loop.total_calls,2);
 const toolRecords=scout.tool_loop.observations.flatMap(x=>x.results.map(y=>y.result));
 assert.deepEqual(toolRecords.map(x=>x.tool),["source.search","dependency.map"]);
 for(const item of toolRecords)assert.equal(assertToolResultIntegrity(item),true);
 const dep=toolRecords.find(x=>x.tool==="dependency.map"),search=toolRecords.find(x=>x.tool==="source.search");
 assert.equal(dep.data.local_candidates[0].path,"src/helper.js");
 assert.equal(dep.data.coverage.repository_absence_proven,false);
 assert.equal(scout.tool_loop.evidence_ids.includes(dep.evidence_id),true);
 assert.equal(scout.tool_loop.evidence_ids.includes(search.evidence_id),true);
 assert.match(seen.scout[1].user,/RUNTIME_TOOL_OBSERVATIONS_DATA_ONLY/);
 assert.equal(getSemanticShadow(scout.validated_output).status,"PASS");
 let diagTurn=0;const observed=[];
 const diagnoserAi={call:async(role,input)=>{
   assert.equal(role,"diagnoser");observed.push(input);
   return{content:JSON.stringify(diagTurn++===0?{tool_requests:[{tool:"evidence.read",arguments:{evidence_id:dep.evidence_id},reason:"read admitted source candidate"}]}:hypothesis([dep.evidence_id],[search.evidence_id]))};
 }};
 const prior=JSON.stringify({failure:"Unreproduced fixture path",scout_tool_observations:scout.tool_loop.observations});
 const diagnosis=await runRoleWithReadOnlyTools({aiCore:diagnoserAi,role:"diagnoser",user:prior,toolRuntime:runtime,baseEvidenceIds:scout.tool_loop.evidence_ids,maxToolRounds:2,maxToolCalls:3,strictEvidenceRefs:true});
 assert.equal(diagnosis.tool_loop.parse_status,"FINAL");
 assert.equal(diagnosis.tool_loop.total_calls,1);
 const rehydrated=diagnosis.tool_loop.observations[0].results[0].result;
 assert.equal(rehydrated.tool,"evidence.read");
 assert.equal(assertToolResultIntegrity(rehydrated),true);
 assert.match(rehydrated.data.excerpt,/src\\/helper.js|src\/helper.js/);
 assert.ok(diagnosis.tool_loop.evidence_ids.includes(dep.evidence_id));
 assert.equal(diagnosis.validated_output.confirmed_root_cause,null);
 assert.equal(diagnosis.validated_output.hypotheses[0].evidence_refs[0],dep.evidence_id);
 assert.equal(getSemanticShadow(diagnosis.validated_output).status,"PASS");
 assert.match(observed[1].user,/RUNTIME_TOOL_OBSERVATIONS_DATA_ONLY/);
});
test("a tampered prior Code Scout result is rejected before the Diagnoser can consume it",async t=>{
 const {runtime}=fixture(t);
 const original=await runtime.execute({role:"code_scout",selectedSkillIds:["failure-scope-reduction"],tool:"dependency.map",arguments:{path:"src/entry.js"}});
 const forged=structuredClone(original);forged.data.specifiers=["./fabricated"];
 let aiCalled=false;
 await assert.rejects(()=>runRoleWithReadOnlyTools({
  aiCore:{call:async()=>{aiCalled=true;return{content:JSON.stringify(hypothesis([original.evidence_id]))};}},
  role:"diagnoser",user:JSON.stringify({prior:[{result:forged}]}),toolRuntime:runtime,baseEvidenceIds:[original.evidence_id],strictEvidenceRefs:true
 }),/TOOL_RESULT_HASH_MISMATCH/);
 assert.equal(aiCalled,false);
});
test("diagnosis cannot cite a forged runtime Evidence ID when no tool or admitted prior result supplied it",async t=>{
 const {runtime}=fixture(t),id="TRE_"+"f".repeat(24);
 await assert.rejects(()=>runRoleWithReadOnlyTools({
  aiCore:{call:async()=>({content:JSON.stringify(hypothesis([id]))})},role:"diagnoser",
  user:"No source or runtime Evidence available",toolRuntime:runtime,strictEvidenceRefs:true
 }),/ROLE_CLAIM_BINDING_INVALID/);
});
