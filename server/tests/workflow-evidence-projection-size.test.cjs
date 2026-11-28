"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeEvidenceRecord}=require("../control/evidence-registry.js");
const {makeToolResult,evidenceProjection}=require("../control/read-only-tool-runtime.js");
const {evidencePromptView,causalEvidencePromptView,downstreamToolEvidenceView,localEvidenceProjectionShadow}=require("../workflow.js");
const bytes=x=>Buffer.byteLength(JSON.stringify(x),"utf8");
test("projection selects the smaller wire representation without changing canonical evidence",()=>{
  const records=[makeEvidenceRecord("LOCAL_RUNTIME",{content:"small"}),makeEvidenceRecord("LOCAL_RUNTIME",{content:"あ".repeat(8000)+"TAIL"}),makeEvidenceRecord("LOCAL_RUNTIME",{content:"x".repeat(1401)})];
  const snapshot=JSON.stringify(records);
  const candidate=causalEvidencePromptView(records),full=evidencePromptView(records);
  for(let i=0;i<records.length;i++){
    const projection=evidenceProjection(records[i],{maxChars:700});
    const expected=JSON.stringify(records[i].payload).length>1400&&bytes(projection)<bytes(full[i])?projection:full[i];
    assert.deepEqual(candidate[i],expected);
  }
  assert.deepEqual(candidate[0],full[0]);
  assert.equal(candidate[1].parent_evidence_id,records[1].evidence_id);
  assert.equal(candidate[1].parent_digest,records[1].integrity.content_sha256);
  assert.equal(JSON.stringify(records),snapshot);
  const shadow=localEvidenceProjectionShadow(records);
  assert.equal(shadow.mode,"SHADOW_ONLY");
  assert.equal(shadow.baseline_bytes,bytes(full));
  assert.equal(shadow.candidate_bytes,bytes(candidate));
  assert.equal(shadow.saved_bytes,bytes(full)-bytes(candidate));
  assert.ok(shadow.saved_bytes>0);
  assert.equal(shadow.record_count,3);
  assert.equal(JSON.stringify(shadow).includes("TAIL"),false);
});
test("tool evidence retains full view when reread is unavailable and never expands wire bytes",()=>{
  const records=[makeToolResult("source.read",{content:"x".repeat(1401)}),makeToolResult("source.read",{content:"あ".repeat(9000)})];
  const full=evidencePromptView(records),before=JSON.stringify(records);
  assert.deepEqual(downstreamToolEvidenceView(records,false),full);
  const view=downstreamToolEvidenceView(records,true);
  for(let i=0;i<records.length;i++)assert.ok(bytes(view[i])<=bytes(full[i]));
  assert.equal(view[1].parent_evidence_id,records[1].evidence_id);
  assert.equal(view[1].parent_digest,records[1].integrity.result_sha256);
  assert.equal(JSON.stringify(records),before);
});
test("empty shadow metrics do not invent savings",()=>{
  assert.deepEqual(localEvidenceProjectionShadow([]),{mode:"SHADOW_ONLY",baseline_bytes:2,candidate_bytes:2,saved_bytes:0,projected_records:0,record_count:0});
});
