"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {REVIEW_EXCLUDED_FIELDS,makePatchPacket,makeReviewPacket,publicReviewPacketSummary,assertPatchRequirements}=require("../control/runtime-packets.js");
const {contentHash}=require("../../orchestrator/durable-contracts.js");

function patchInput(){return{runId:"r",diagnosisRef:"diag",repositoryRevision:"git_baseline",paths:["src/a.js"],reproductionSummary:{status:"FAILED_RETEST",checks:[{status:"FAIL",evidence_refs:["E_FAILED"]}]},invariants:[{name:"requirements",preserved_behavior:["input unchanged"],acceptance_conditions:[{test:"boundary",expected:{status:"PASS"}}],unknowns:["external dependency"]}],testInventory:[{name:"unit",args:["--boundary"]}]};}

test("patch packet retains nested requirements and failed evidence after caller mutation",()=>{
  const input=patchInput(),packet=makePatchPacket(input),before=JSON.stringify(packet);
  input.reproductionSummary.checks[0].status="PASS";
  input.reproductionSummary.checks[0].evidence_refs[0]="E_NOT_EXECUTED";
  input.invariants[0].preserved_behavior.length=0;
  input.invariants[0].acceptance_conditions[0].expected.status="SKIP";
  input.testInventory[0].args.push("--skip");
  assert.equal(JSON.stringify(packet),before);
  assert.equal(packet.packet_digest,contentHash({schema:packet.schema,payload:packet.payload}));
  assert.equal(Object.isFrozen(input.reproductionSummary.checks),false);
});

test("patch packet rejects direct nested requirement and evidence mutation",()=>{
  const packet=makePatchPacket(patchInput());
  assert.throws(()=>{packet.payload.reproduction_summary.checks[0].status="PASS";},TypeError);
  assert.throws(()=>packet.payload.invariants[0].unknowns.push("fabricated"),TypeError);
  assert.throws(()=>{packet.payload.invariants[0].acceptance_conditions[0].expected.status="SKIP";},TypeError);
  assert.equal(packet.payload.reproduction_summary.checks[0].status,"FAIL");
});

test("review packet holdout cannot change nested acceptance verdict through input alias",()=>{
  const condition={status:"FAIL",evidence_refs:["E_TEST_FAILURE"]};
  const input={candidateRef:"candidate",applyReceiptRef:"receipt",repositoryRevision:"git_after",changedPaths:["src/a.js"],diff:"diff",executedTests:[{name:"unit",details:condition}],testResults:[{name:"unit",details:condition}],invariants:[{name:"acceptance",status:"FAIL",details:condition}],prePostHashes:{"src/a.js":{before:"before",after:"after"}}};
  const packet=makeReviewPacket(input),before=JSON.stringify(packet);
  assert.equal(packet.packet_digest,"9db700dc219fc28034cd54348b6a5ec6ee9fa5e92da7efc1dbb6bba55f31d268");
  condition.status="PASS";condition.evidence_refs.length=0;input.prePostHashes["src/a.js"].after="different";
  assert.equal(JSON.stringify(packet),before);
  assert.throws(()=>{packet.payload.test_results[0].details.status="PASS";},TypeError);
  assert.equal(publicReviewPacketSummary(packet).invariants_pass,false);
  assert.equal(packet.packet_digest,contentHash({schema:packet.schema,payload:packet.payload}));
});

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


test("P1-A packet denies nested paths under protected directories without overblocking siblings",()=>{
  const input={runId:"r_scoped",diagnosisRef:"diag",repositoryRevision:"git_before",prohibitedPaths:["secrets","src/private"],paths:["secrets/token.json"]};
  assert.throws(()=>makePatchPacket(input),/PATCH_PACKET_PROHIBITED_PATH:secrets\/token.json/);
  assert.throws(()=>makePatchPacket({...input,paths:["src/private/nested/config.json"]}),/PATCH_PACKET_PROHIBITED_PATH:src\/private\/nested\/config.json/);
  assert.throws(()=>makePatchPacket({...input,paths:["src/../secrets/token.json"]}),/PATCH_PACKET_PROHIBITED_PATH:secrets\/token.json/);
  const allowed=makePatchPacket({...input,paths:["src/private-utils/index.js"]});
  assert.deepEqual(allowed.payload.paths,["src/private-utils/index.js"]);
});


test("P1-A candidate operations cannot bypass packet-level directory exclusions",()=>{
  const packet=makePatchPacket({runId:"r_denied",diagnosisRef:"diag",repositoryRevision:"git_before",paths:["src/a.js"],prohibitedPaths:["secrets","src/private"]});
  assert.throws(()=>assertPatchRequirements(packet,{operations:[{type:"write",path:"secrets/nested/token.txt",content:"x"}]}),/REQUIREMENT_FORBIDDEN_PATH:secrets\/nested\/token.txt/);
  assert.throws(()=>assertPatchRequirements(packet,{operations:[{type:"replace",path:"src/private/../private/key.js",old:"x",new:"y"}]}),/REQUIREMENT_FORBIDDEN_PATH:src\/private\/key.js/);
  assert.doesNotThrow(()=>assertPatchRequirements(packet,{operations:[{type:"write",path:"src/private-tools/a.js",content:"x"}]}));
});
