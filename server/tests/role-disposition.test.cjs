"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {DECISION,makeRoleDisposition,shadowSearchDisposition}=require("../control/role-disposition.js");

const base={runId:"r1",repositoryRevision:"git_abc",inputDigest:"a".repeat(64)};

test("role disposition records non-executed role decisions without fabricating RoleResult",()=>{
  const disposition=makeRoleDisposition({...base,role:"researcher",decision:DECISION.SATISFIED_BY_EVIDENCE,reasonCode:"CURRENT_AUTHORITY_ALREADY_VERIFIED",evidenceRefs:["EVI_1"]});
  assert.equal(disposition.schema,"debugai.role-disposition/v1");
  assert.equal(disposition.decision,"SATISFIED_BY_EVIDENCE");
  assert.deepEqual(disposition.evidence_refs,["EVI_1"]);
  assert.equal(Object.prototype.hasOwnProperty.call(disposition,"role_result_id"),false);
});

test("satisfied disposition requires evidence and blocked disposition requires bounded reason",()=>{
  assert.throws(()=>makeRoleDisposition({...base,role:"code_scout",decision:DECISION.SATISFIED_BY_EVIDENCE,reasonCode:"SOURCE_ALREADY_BOUND"}),/ROLE_DISPOSITION_SATISFIED_EVIDENCE_REQUIRED/);
  assert.throws(()=>makeRoleDisposition({...base,role:"diagnoser",decision:DECISION.BLOCKED,reasonCode:"MAYBE"}),/ROLE_DISPOSITION_BLOCK_REASON_INVALID/);
  const blocked=makeRoleDisposition({...base,role:"diagnoser",decision:DECISION.BLOCKED,reasonCode:"WAIT_EVIDENCE"});
  assert.equal(blocked.decision,"BLOCKED");
});

test("search shadow can record no-search decision before provider calls",()=>{
  const disposition=shadowSearchDisposition({...base,searchKind:"official",requiredSearch:false,reasonCode:"NO_EXTERNAL_AUTHORITY_REQUIRED"});
  assert.equal(disposition.role,"search:official");
  assert.equal(disposition.decision,"NOT_APPLICABLE");
  assert.equal(disposition.producer,"deterministic_search_shadow");
});
