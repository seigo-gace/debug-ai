"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeEvidenceRecord}=require("../control/evidence-registry.js");
const {validateEvidenceRecords,mergeBaseEvidenceWithRecords,evidencePromptView}=require("../control/role-work-item-evidence.js");

test("role-work-item evidence helper validates and merges ids",()=>{
  const a=makeEvidenceRecord("LOCAL_RUNTIME",{observation:"x"});
  const b=makeEvidenceRecord("LOCAL_RUNTIME",{observation:"y"});
  const validated=validateEvidenceRecords([a,b]);
  assert.equal(validated.length,2);
  const merged=mergeBaseEvidenceWithRecords([a.evidence_id],validated);
  assert.deepEqual(merged,[a.evidence_id,b.evidence_id]);
  const view=evidencePromptView(validated);
  assert.equal(view[0].integrity,undefined);
  assert.equal(view[0].evidence_id,a.evidence_id);
});
