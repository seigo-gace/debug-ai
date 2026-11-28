"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeEvidenceRecord}=require("../control/evidence-registry.js");
const {compactResearchInventory}=require("../control/tool-loop.js");
const {evidenceProjection}=require("../control/read-only-tool-runtime.js");
const record=(kind,text)=>makeEvidenceRecord("LOCAL_RUNTIME",{kind,value:{content:text}});
const view=r=>{const {integrity,...v}=r;return v;};
const selected={tools:["evidence.read"]};
test("research and diagnosis use smaller inventory view only when the exact full record can be read",()=>{
 const inventory=record("initial_test_inventory","checks ".repeat(1000)),source=record("initial_source","source ".repeat(1000)),failure=record("deterministic_check","failure ".repeat(1000));
 const records=[inventory,source,failure],ids=records.map(x=>x.evidence_id),user=JSON.stringify({task:"repair",localEvidence:records.map(view)});
 for(const role of ["researcher","diagnoser"]){
  const compact=compactResearchInventory(user,role,selected,records,ids),parsed=JSON.parse(compact.user);
  assert.equal(compact.projected_records,1);assert.ok(compact.candidate_bytes<compact.baseline_bytes);
  assert.equal(parsed.localEvidence[0].parent_evidence_id,inventory.evidence_id);
  assert.equal(parsed.localEvidence[0].parent_digest,inventory.integrity.content_sha256);
  assert.deepEqual(parsed.localEvidence.slice(1),records.slice(1).map(view));
  assert.equal(evidenceProjection(inventory,{maxChars:12000}).projection_completeness,"COMPLETE");
 }
 for(const role of ["code_scout","causal_scout","local_reviewer","patch_engineer"])assert.equal(compactResearchInventory(user,role,selected,records,ids).user,user);
 assert.equal(compactResearchInventory(user,"researcher",{tools:[]},records,ids).user,user);
 assert.equal(compactResearchInventory(user,"researcher",selected,records,[]).user,user);
});
test("no projection when a full bounded reread is impossible or supplied view differs",()=>{
 const huge=record("initial_test_inventory","x".repeat(16000)),small=record("initial_test_inventory","x".repeat(10)),changed=record("initial_test_inventory","y".repeat(4000));
 const records=[huge,small,changed],views=records.map(view);views[2]={...views[2],payload:{...views[2].payload,value:{content:"different"}}};
 const user=JSON.stringify({localEvidence:views});
 assert.equal(compactResearchInventory(user,"diagnoser",selected,records,records.map(x=>x.evidence_id)).user,user);
});
