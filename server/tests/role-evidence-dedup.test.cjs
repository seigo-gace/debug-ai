const test=require("node:test"),assert=require("node:assert/strict");
const {deduplicateRoleEvidence}=require("../control/role-prompt-evidence.js");
const record={schema:"debugai.evidence-record/v1",evidence_id:"EVI_1",data:"source ".repeat(500)};
test("live evidence dedup retains identical full record, preserves group order, and measures bytes",()=>{
 const original={localEvidence:[record],knownKnowledge:[record],official:[{other:"value"},record]};
 const out=deduplicateRoleEvidence(JSON.stringify(original),["EVI_1"]),v=JSON.parse(out.user);
 assert.equal(out.deduplicated_records,2);assert.ok(out.candidate_bytes<out.baseline_bytes);
 assert.deepEqual(v.localEvidence,[record]);assert.deepEqual(v.knownKnowledge,[{registered_evidence_ref:"EVI_1"}]);
 assert.deepEqual(v.official,[{other:"value"},{registered_evidence_ref:"EVI_1"}]);
});
test("conflicting or unadmitted records are never collapsed",()=>{
 const input=JSON.stringify({localEvidence:[record],official:[{...record,data:"different"},record]});
 assert.equal(deduplicateRoleEvidence(input,["EVI_1"]).user,input);
 const duplicate=JSON.stringify({localEvidence:[record],official:[record]});
 assert.equal(deduplicateRoleEvidence(duplicate,[]).user,duplicate);
 assert.equal(deduplicateRoleEvidence("plain user request",["EVI_1"]).user,"plain user request");
});