"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {publicHypothesisReviewEvidence}=require("../workflow.js");
const {registerEvidenceList}=require("../control/evidence-registry.js");
const {assertPublicOpaque}=require("../adapters/external-review.js");
const {makeToolResult}=require("../control/read-only-tool-runtime.js");

test("external hypothesis review receives registered evidence IDs and real deterministic counts, never private source",()=>{
  const rawPath="/home/admin1/private-secret-file.js";
  const localRecords=registerEvidenceList("LOCAL_RUNTIME",[
    {kind:"deterministic_sandbox_check",status:"FAIL",executed:true,name:rawPath,stderr:"private failure detail"},
    {kind:"deterministic_sandbox_check",status:"PASS",executed:true,name:"control"},
  ]);
  const knowledgeRecords=registerEvidenceList("INTERNAL_KB",[{claim:"historical only"}]);
  const chosen=localRecords[0].evidence_id;
  const payload=publicHypothesisReviewEvidence({
    diagnosisJson:{diagnosis_status:"HYPOTHESES_RETAINED",hypotheses:[{
      id:"H1",status:"HYPOTHESIS",evidence_refs:[chosen,"EVI_FAKE"],
      counter_evidence_refs:[knowledgeRecords[0].evidence_id]
    }]},
    localRecords,knowledgeRecords,officialRecords:[],
    deterministicVerification:{status:"FINAL_INVALID",checks:[
      {name:rawPath,status:"FAIL",executed:true,stderr:"private failure detail"},
      {name:"control",status:"PASS",executed:true},
      {name:"skipped",status:"FAIL",executed:false,timed_out:true}
    ]}
  });
  assert.deepEqual(payload.registered_evidence.local_refs,localRecords.map(x=>x.evidence_id));
  assert.deepEqual(payload.registered_evidence.knowledge_refs,[knowledgeRecords[0].evidence_id]);
  assert.deepEqual(payload.registered_evidence.hypothesis_support_refs,[chosen]);
  assert.deepEqual(payload.registered_evidence.hypothesis_counter_refs,[knowledgeRecords[0].evidence_id]);
  assert.deepEqual(payload.deterministic_reproduction,{
    status:"FINAL_INVALID",check_count:3,executed_count:2,passed_count:1,failed_count:1,timed_out_count:1
  });
  const external={privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},
    hypothesis:{statement:"A hypothetical cause",...payload}};
  assert.equal(assertPublicOpaque(external),true);
  assert.doesNotMatch(JSON.stringify(external),/admin1|private|failure detail|EVI_FAKE/);
});

test("review evidence preserves no-data status rather than fabricating a passing check",()=>{
  const payload=publicHypothesisReviewEvidence({
    diagnosisJson:{diagnosis_status:"INSUFFICIENT_EVIDENCE",hypotheses:[]}
  });
  assert.deepEqual(payload.registered_evidence,{
    local_refs:[],knowledge_refs:[],official_refs:[],tool_refs:[],
    hypothesis_support_refs:[],hypothesis_counter_refs:[]
  });
  assert.deepEqual(payload.deterministic_reproduction,{
    status:"NOT_CONFIGURED",check_count:0,executed_count:0,passed_count:0,failed_count:0,timed_out_count:0
  });
});

test("verified role tool evidence remains reviewable without leaking tool output",()=>{
  const tool=makeToolResult("source.read",{path:"/home/admin1/hidden.js",content:"private source text"});
  const payload=publicHypothesisReviewEvidence({
    diagnosisJson:{diagnosis_status:"HYPOTHESES_RETAINED",hypotheses:[{
      id:"H1",status:"HYPOTHESIS",statement:"offset mismatch",evidence_refs:[tool.evidence_id],
      counter_evidence_refs:["TRE_UNVERIFIED"]
    }]},
    scoutToolEvidence:[tool],researchToolEvidence:[tool],diagnosisToolEvidence:[]
  });
  assert.deepEqual(payload.registered_evidence.tool_refs,[tool.evidence_id]);
  assert.deepEqual(payload.registered_evidence.hypothesis_support_refs,[tool.evidence_id]);
  assert.deepEqual(payload.registered_evidence.hypothesis_counter_refs,[]);
  const reviewed={privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},
    hypothesis:{statement:"offset mismatch",...payload}};
  assert.equal(assertPublicOpaque(reviewed),true);
  assert.doesNotMatch(JSON.stringify(reviewed),/hidden|private source|home/);
});

test("forged role tool evidence cannot be promoted to an external review reference",()=>{
  const tool=makeToolResult("source.read",{path:"original.js",content:"safe"});
  const forged={...tool,evidence_id:"TRE_FORGED"};
  assert.throws(()=>publicHypothesisReviewEvidence({
    diagnosisJson:{hypotheses:[{status:"HYPOTHESIS",evidence_refs:["TRE_FORGED"]}]},
    diagnosisToolEvidence:[forged]
  }),/TOOL_RESULT_EVIDENCE_ID_MISMATCH/);
});
