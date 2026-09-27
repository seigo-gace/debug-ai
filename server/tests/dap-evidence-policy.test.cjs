"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {failureClass,shouldCollectDapEvidence,deriveDebugTarget,hintOnlyEvidence,assertDapEvidenceBoundary}=require("../control/dap-evidence-policy.js");

test("DAP admission matches historical Runtime/E2E-only failure policy",()=>{
  assert.equal(failureClass([{status:"FAIL",check_type:"typecheck",name:"typecheck",stderr:"TypeError: x"}]),"TYPECHECK");
  assert.equal(shouldCollectDapEvidence([{status:"FAIL",check_type:"typecheck",name:"typecheck",stderr:"TypeError: x"}]),false);
  assert.equal(failureClass([{status:"FAIL",check_type:"unit",name:"test",stderr:"AssertionError: no"}]),"TEST_ASSERTION");
  assert.equal(shouldCollectDapEvidence([{status:"FAIL",check_type:"unit",name:"test",stderr:"AssertionError: no"}]),false);
  assert.equal(failureClass([{status:"FAIL",check_type:"unit",name:"test",stderr:"TypeError: undefined at src/a.js:9:2"}]),"RUNTIME");
  assert.equal(shouldCollectDapEvidence([{status:"FAIL",check_type:"unit",name:"test",stderr:"TypeError: undefined at src/a.js:9:2"}]),true);
  assert.equal(failureClass([{status:"FAIL",check_type:"e2e",name:"e2e",stderr:"failed"}]),"E2E");
  assert.equal(shouldCollectDapEvidence([{status:"FAIL",check_type:"e2e",name:"e2e",stderr:"failed"}]),true);
});

test("deriveDebugTarget accepts only existing repo-local supported files",()=>{
  const repo=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-dap-policy-"));
  try{
    fs.mkdirSync(path.join(repo,"src"));
    fs.writeFileSync(path.join(repo,"src","a.js"),"throw new Error('x');\n");
    const target=deriveDebugTarget(repo,[{status:"FAIL",check_type:"unit",stderr:"TypeError at src/a.js:1:1"}],"");
    assert.equal(target.file,path.join(repo,"src","a.js"));
    assert.equal(target.line,1);
    assert.equal(target.configurationName,"node");
    const outside=path.join(path.dirname(repo),"outside.js");
    fs.writeFileSync(outside,"x\n");
    assert.equal(deriveDebugTarget(repo,[{status:"FAIL",check_type:"unit",stderr:`TypeError at ${outside}:1:1`}],""),null);
    fs.rmSync(outside,{force:true});
  }finally{fs.rmSync(repo,{recursive:true,force:true});}
});

test("DAP evidence can never become completion authority",()=>{
  const ev=hintOnlyEvidence({status:"PASS",reason:"RUNTIME_DEBUG_SESSION_EXECUTED",target:{file:"/tmp/a.js",line:1},records:[{tool:"get_debug_status"}]});
  assert.equal(ev.authority,"HINT_ONLY");
  assert.equal(ev.local_only,true);
  assert.equal(ev.configured,true);
  assert.equal(ev.executed,true);
  assert.equal(assertDapEvidenceBoundary(ev),true);
  assert.throws(()=>assertDapEvidenceBoundary({...ev,authority:"FACT"}),/DAP_EVIDENCE_AUTHORITY_INVALID/);
});
