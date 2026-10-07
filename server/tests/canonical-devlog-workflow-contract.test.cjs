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
