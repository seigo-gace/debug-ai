"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeEvidenceRecord,assertEvidenceRecord,registerEvidenceList,evidenceIds,registrySummary}=require("../control/evidence-registry.js");
const {parseAndValidateRoleOutput}=require("../control/role-output-validator.js");
const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");
const {createWorkflow}=require("../workflow.js");

test("evidence registry creates deterministic source-scoped EVI ids with integrity validation",()=>{
  const a=makeEvidenceRecord("LOCAL_RUNTIME",{id:"L1",observation:"boom"});
  const b=makeEvidenceRecord("LOCAL_RUNTIME",{observation:"boom",id:"L1"});
  const c=makeEvidenceRecord("INTERNAL_KB",{id:"L1",observation:"boom"});
  assert.equal(a.evidence_id,b.evidence_id);
  assert.notEqual(a.evidence_id,c.evidence_id);
  assert.match(a.evidence_id,/^EVI_[a-f0-9]{24}$/);
  assert.equal(assertEvidenceRecord(a),true);
  const tampered={...a,payload:{id:"L1",observation:"changed"}};
  assert.throws(()=>assertEvidenceRecord(tampered),/EVIDENCE_RECORD_HASH_MISMATCH/);
});

test("registry deduplicates records and summarizes local, KB, and official evidence",()=>{
  const local=registerEvidenceList("LOCAL_RUNTIME",[{id:"L1",observation:"x"},{id:"L1",observation:"x"}]);
  const kb=registerEvidenceList("INTERNAL_KB",[{id:"K1",message:"known"}]);
  const official=registerEvidenceList("OFFICIAL_EXTERNAL",[{source_ref:"O1",title:"Spec"}]);
  assert.equal(local.length,1);
  const summary=registrySummary({local,kb,official});
  assert.equal(summary.total,3);
  assert.equal(summary.evidence_ids.length,3);
  assert.deepEqual(evidenceIds(local),[local[0].evidence_id]);
});

test("strict role evidence binding rejects arbitrary refs and accepts registered EVI ids",()=>{
  const record=makeEvidenceRecord("LOCAL_RUNTIME",{id:"L1",observation:"observed"});
  const good=JSON.stringify({claims:[{type:"FACT",text:"observed",evidence_refs:[record.evidence_id]}],decision:"HANDOFF"});
  assert.equal(parseAndValidateRoleOutput("diagnoser",good,{availableEvidenceIds:[record.evidence_id],strictEvidenceRefs:true}).claims[0].type,"FACT");
  const legacy=JSON.stringify({claims:[{type:"FACT",text:"unsupported",evidence_refs:["L1"]}],decision:"HANDOFF"});
  assert.throws(()=>parseAndValidateRoleOutput("diagnoser",legacy,{availableEvidenceIds:[record.evidence_id],strictEvidenceRefs:true}),/EVIDENCE_REF_UNKNOWN/);
});

test("tool loop exposes registered base evidence IDs and enforces them on final claims",async()=>{
  const record=makeEvidenceRecord("LOCAL_RUNTIME",{id:"L1",observation:"observed"});
  let seenSystem="";
  const aiCore={call:async(_role,opts)=>{seenSystem=opts.system;return{content:JSON.stringify({claims:[{type:"FACT",text:"observed",evidence_refs:[record.evidence_id]}],decision:"HANDOFF"}),control_plane:{selected_skill_ids:["failure-scope-reduction"]}};}};
  const out=await runRoleWithReadOnlyTools({aiCore,role:"code_scout",user:"x",baseEvidenceIds:[record.evidence_id],strictEvidenceRefs:true});
  assert.match(seenSystem,new RegExp(record.evidence_id));
  assert.deepEqual(out.tool_loop.evidence_ids,[record.evidence_id]);
  assert.equal(out.validated_output.claims[0].type,"FACT");
});

test("workflow normalizes local, TGserver, and official evidence before analysis roles",async()=>{
  const roleUsers=[];
  const aiCore={call:async(role,opts)=>{roleUsers.push([role,JSON.parse(opts.user)]);return{content:JSON.stringify(role==="diagnoser"?{cause:"x"}:role==="researcher"?{evidence_ids:[]}:{authority:"HINT_ONLY"}),control_plane:{selected_skill_ids:[]}};}};
  const tgserver={log:async()=>({}),search:async()=>[{id:"K1",message:"known fix"}]};
  const evidenceSearch={search:async()=>[{source_ref:"O1",title:"Official",url:"https://example.test/spec",authority:"OFFICIAL"}]};
  const workflow=createWorkflow({aiCore,tgserver,evidenceSearch});
  const result=await workflow.runAnalysis({failure:{message:"boom"},localEvidence:[{id:"L1",observation:"local fact"}]});
  assert.equal(result.evidence_registry.groups.local.count,1);
  assert.equal(result.evidence_registry.groups.knowledge.count,1);
  assert.equal(result.evidence_registry.groups.official.count,1);
  assert.equal(result.evidence_registry.total,3);
  const scout=roleUsers.find(([role])=>role==="code_scout")[1];
  assert.match(scout.evidence[0].evidence_id,/^EVI_/);
  const researcher=roleUsers.find(([role])=>role==="researcher")[1];
  assert.match(researcher.knownKnowledge[0].evidence_id,/^EVI_/);
  assert.match(researcher.official[0].evidence_id,/^EVI_/);
});
