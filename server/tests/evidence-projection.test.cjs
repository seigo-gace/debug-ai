"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeEvidenceProjection}=require("../control/evidence-projection.js");

test("evidence projection is a bounded view that preserves parent identity and independent statuses",()=>{
  const content="x".repeat(5000);
  const projection=makeEvidenceProjection({parentEvidenceId:"EVI_parent",parentDigest:"a".repeat(64),repositoryRevision:"git_abc",evidenceKind:"LOCAL_SOURCE",source:"src/a.js",version:"1.2.3",range:{start:10,end:20},content,maxExcerptChars:1200,provenanceStatus:"VERIFIED",applicabilityStatus:"SUPPORTED",executionStatus:"NOT_RUN",observedOutcome:"UNKNOWN",claimSupportStatus:"SUPPORTED",projectionCompleteness:"PARTIAL",omittedCount:2,omissionReason:"irrelevant adjacent lines"});
  assert.equal(projection.parent_evidence_id,"EVI_parent");
  assert.equal(projection.parent_digest,"a".repeat(64));
  assert.equal(projection.repository_revision,"git_abc");
  assert.equal(projection.excerpt.length,1200);
  assert.equal(projection.excerpt_truncated,true);
  assert.equal(projection.original_chars,5000);
  assert.equal(projection.provenance_status,"VERIFIED");
  assert.equal(projection.execution_status,"NOT_RUN");
  assert.equal(projection.observed_outcome,"UNKNOWN");
  assert.equal(projection.omitted_count,2);
  assert.match(projection.projection_id,/^EVP_[a-f0-9]{24}$/);
  assert.match(projection.projection_digest,/^[a-f0-9]{64}$/);
});

test("evidence projection never invents unsupported statuses and requires parent integrity",()=>{
  const projection=makeEvidenceProjection({parentEvidenceId:"TRE_1",parentDigest:"b".repeat(64),content:"fact",provenanceStatus:"MAGIC_PASS",projectionCompleteness:"COMPLETE"});
  assert.equal(projection.provenance_status,"UNKNOWN");
  assert.equal(projection.projection_completeness,"COMPLETE");
  assert.throws(()=>makeEvidenceProjection({parentEvidenceId:"EVI_x",parentDigest:"bad",content:"x"}),/EVIDENCE_PROJECTION_PARENT_DIGEST_INVALID/);
  assert.throws(()=>makeEvidenceProjection({parentDigest:"c".repeat(64),content:"x"}),/EVIDENCE_PROJECTION_PARENT_ID_REQUIRED/);
});
