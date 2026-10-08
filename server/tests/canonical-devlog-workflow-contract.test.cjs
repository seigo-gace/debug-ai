"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("canonical DevLog activation poll keeps valid HTTP guard syntax",()=>{
  const workflow=fs.readFileSync(path.resolve(__dirname,"../../.github/workflows/chatgpt-canonical-devlog-activate-live.yml"),"utf8");
  assert.doesNotMatch(workflow,/\[ "\$code" = "202" \|\| return 11/);
  assert.match(workflow,/\[ "\$code" = "202" \] \|\| return 11/);
  assert.match(workflow,/canonical\.devlog_activate_status/);
});

test("canonical activation cannot use approval booleans without exact owner Github receipt",()=>{
  const wf=fs.readFileSync(path.resolve(__dirname,"../../.github/workflows/chatgpt-canonical-devlog-activate-live.yml"),"utf8");
  const target=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../.github/canonical-devlog-activate-target.json"),"utf8"));
  assert.equal(target.enabled,false);
  assert.equal(target.approval_comment_id,6057495658);
  assert.equal(target.helper_head,"2008cc936da224becc080e20c57dfa7b96f364a8");
  assert.match(wf,/name: Require exact owner approval/);
  assert.match(wf,/OWNER_APPROVAL_RECORD_VERIFIED=PASS/);
  assert.match(wf,/\.user\.login=="seigo-gace"/);
  assert.match(wf,/\.author_association=="OWNER"/);
  assert.match(wf,/\.performed_via_github_app\.slug=="chatgpt-codex-connector"/);
  assert.match(wf,/OWNER_APPROVAL_IS_NOT_HOST_RECEIPT=TRUE/);
  const approvalIndex=wf.indexOf("name: Require exact owner approval");
  const startIndex=wf.indexOf("name: Start Canonical DevLog activation");
  assert.ok(approvalIndex>0 && startIndex>approvalIndex);
});
