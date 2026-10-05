"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseNodeTestSummary,requirePassingTestSummary}=require("../control/sandbox-queue-selftest.js");

function node24({tests=446,pass=446,fail=0,skipped=0}={}){return `ℹ tests ${tests}\nℹ suites 0\nℹ pass ${pass}\nℹ fail ${fail}\nℹ cancelled 0\nℹ skipped ${skipped}\nℹ todo 0\nℹ duration_ms 1\n`;}
function legacy({tests=446,pass=446,fail=0,skipped=0}={}){return `# tests ${tests}\n# suites 0\n# pass ${pass}\n# fail ${fail}\n# cancelled 0\n# skipped ${skipped}\n# todo 0\n# duration_ms 1\n`;}

test("sandbox full-suite summary accepts Node 24 informational format",()=>{
  assert.deepEqual(requirePassingTestSummary(node24()),{tests:446,pass:446,fail:0,skipped:0});
});

test("sandbox full-suite summary accepts legacy TAP comment format",()=>{
  assert.deepEqual(requirePassingTestSummary(legacy()),{tests:446,pass:446,fail:0,skipped:0});
});

test("sandbox full-suite summary fails closed when a required counter is missing",()=>{
  const output="ℹ tests 446\nℹ pass 446\nℹ fail 0\n";
  assert.equal(parseNodeTestSummary(output),null);
  assert.throws(()=>requirePassingTestSummary(output),/SANDBOX_FULL_SUITE_SUMMARY_EVIDENCE_MISSING/);
});

test("sandbox full-suite summary rejects nonzero failures",()=>{
  assert.throws(()=>requirePassingTestSummary(node24({tests:446,pass:445,fail:1,skipped:0})),/SANDBOX_FULL_SUITE_PASS_EVIDENCE_INVALID|SANDBOX_FULL_SUITE_ZERO_FAIL_EVIDENCE_MISSING/);
});

test("sandbox full-suite summary rejects skipped tests",()=>{
  assert.throws(()=>requirePassingTestSummary(node24({tests:446,pass:446,fail:0,skipped:1})),/SANDBOX_FULL_SUITE_ZERO_SKIP_EVIDENCE_MISSING/);
});

test("sandbox full-suite summary rejects pass count that does not equal tests",()=>{
  assert.throws(()=>requirePassingTestSummary(legacy({tests:446,pass:445,fail:0,skipped:0})),/SANDBOX_FULL_SUITE_PASS_EVIDENCE_INVALID/);
});
