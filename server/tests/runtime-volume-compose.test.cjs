"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {composeGate}=require("../gates.js");

const source=path.join(__dirname,"..","..","compose.yaml");
function gateFor(t,transform){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-compose-runtime-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,"compose.yaml");
  fs.writeFileSync(file,transform(fs.readFileSync(source,"utf8")));
  return composeGate(file);
}

test("production compose requires private runtime-volume initialization",()=>{
  assert.deepEqual(composeGate(source),{pass:true,failures:[]});
});

test("runtime init service cannot be removed",t=>{
  const out=gateFor(t,s=>s.replace("  runtime-init:\n","  runtime-init-missing:\n"));
  assert.equal(out.pass,false);
  assert.ok(out.failures.includes("RUNTIME_INIT_SERVICE_MISSING"));
});

test("runtime root cannot be relaxed to group/world permissions",t=>{
  const out=gateFor(t,s=>s.replace("chmod 0700 /runtime","chmod 0755 /runtime"));
  assert.equal(out.pass,false);
  assert.ok(out.failures.includes("RUNTIME_INIT_ROOT_MODE_REQUIRED"));
});

test("debug-ai must wait for successful runtime initialization",t=>{
  const out=gateFor(t,s=>s.replace("      runtime-init:\n        condition: service_completed_successfully","      runtime-init-broken:\n        condition: service_completed_successfully"));
  assert.equal(out.pass,false);
  assert.ok(out.failures.includes("DEBUG_AI_RUNTIME_INIT_DEPENDENCY_REQUIRED"));
});
