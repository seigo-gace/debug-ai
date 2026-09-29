"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {REVIEW_EXCLUDED_FIELDS,makePatchPacket,makeReviewPacket,publicReviewPacketSummary}=require("../control/runtime-packets.js");

test("patch packet binds diagnosis, revision, scope and evidence without model-side mutation authority",()=>{
  const packet=makePatchPacket({runId:"r1",diagnosisRef:"diag_1",repositoryRevision:"git_abc",paths:["src/a.js","src/a.js"],sourceExcerpts:[{path:"src/a.js",excerpt:"const x=1"}],preconditionHashes:{"src/a.js":"a".repeat(64)},reproductionSummary:{status:"REPRODUCED"},testInventory:[{name:"test",configured:true}],invariants:[{name:"scope",status:"PASS"}],prohibitedPaths:[".env"],evidenceRefs:["EVI_1","EVI_1"]});
  assert.equal(packet.schema,"debugai.patch-packet/v1");
  assert.deepEqual(packet.payload.paths,["src/a.js"]);
  assert.deepEqual(packet.payload.evidence_refs,["EVI_1"]);
  assert.match(packet.packet_digest,/^[a-f0-9]{64}$/);
  assert.throws(()=>makePatchPacket({runId:"r1",diagnosisRef:"d",repositoryRevision:"git_x",paths:[".env"],prohibitedPaths:[".env"]}),/PATCH_PACKET_PROHIBITED_PATH/);
});

test("review packet requires actual applied diff and executed tests from fresh deterministic context",()=>{
  const packet=makeReviewPacket({candidateRef:"cand_1",applyReceiptRef:"apply_1",repositoryRevision:"git_after",changedPaths:["src/a.js"],diff:"--- a/src/a.js\n+++ b/src/a.js",prePostHashes:{"src/a.js":{before:"a",after:"b"}},executedTests:[{name:"unit",status:"PASS"}],testResults:[{name:"unit",status:"PASS"}],invariants:[{name:"scope",status:"PASS"}],evidenceRefs:["EVI_TEST"]});
  assert.equal(packet.schema,"debugai.review-packet/v1");
  assert.deepEqual(packet.payload.excluded_fields,REVIEW_EXCLUDED_FIELDS);
  assert.equal(packet.payload.excluded_fields.includes("patch_engineer_raw_reasoning"),true);
  assert.match(packet.packet_digest,/^[a-f0-9]{64}$/);
  assert.throws(()=>makeReviewPacket({candidateRef:"c",applyReceiptRef:"a",repositoryRevision:"git",changedPaths:["x"],diff:"d"}),/REVIEW_PACKET_EXECUTED_TESTS_REQUIRED/);
});

test("public review summary exposes only opaque review metadata and never diff content",()=>{
  const secretDiff="--- a/src/private.js\n+++ b/src/private.js\n+const secret='do-not-export';";
  const packet=makeReviewPacket({candidateRef:"cand_1",applyReceiptRef:"apply_1",repositoryRevision:"git_after",changedPaths:["src/private.js"],diff:secretDiff,prePostHashes:{"src/private.js":{before:"a",after:"b"}},executedTests:[{name:"unit",status:"PASS"}],testResults:[{name:"unit",status:"PASS"}],invariants:[{name:"scope",status:"PASS"}],evidenceRefs:["EVI_TEST"]});
  const summary=publicReviewPacketSummary(packet,{localVerdict:"pass"});
  assert.equal(summary.schema,"debugai.review-packet-public-summary/v1");
  assert.equal(summary.packet_digest,packet.packet_digest);
  assert.equal(summary.changed_path_count,1);
  assert.equal(summary.executed_test_count,1);
  assert.equal(summary.test_result_count,1);
  assert.equal(summary.invariants_pass,true);
  assert.equal(summary.local_verdict,"PASS");
  const serialized=JSON.stringify(summary);
  assert.equal(serialized.includes("private.js"),false);
  assert.equal(serialized.includes("do-not-export"),false);
  assert.equal(serialized.includes(secretDiff),false);
});
