"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {initialInvestigationEvidence}=require("../control/read-only-tool-runtime.js");
const {addBoundedTestDependencyEvidence}=require("../workflow.js");
function fixture(callback){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-initial-dependency-"));
 try{return callback(root);}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test("a failing real test seeds its directly imported implementation, without pretending call proof",()=>{
 fixture(root=>{
  fs.mkdirSync(path.join(root,"src"));
  fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node --test unicode-search.test.cjs"}}));
  fs.writeFileSync(path.join(root,"unicode-search.test.cjs"),'const assert=require("node:assert"); const search=require("./src/offset.js");\n');
  fs.writeFileSync(path.join(root,"src/offset.js"),"function excerpt(s,offset){return s.slice(offset);} module.exports=excerpt;\n");
  const source=initialInvestigationEvidence(root,{request:"Investigate a Unicode search excerpt mismatch",
    checks:[{status:"FAIL",executed:true,timed_out:false}]});
  assert.equal(source.records.filter(x=>x.kind==="initial_dependency_candidate").length,0);
  const actual=addBoundedTestDependencyEvidence(root,source);
  const items=actual.records.filter(x=>x.kind==="initial_dependency_candidate");
  assert.equal(items.length,1);
  assert.equal(items[0].value.path,"src/offset.js");
  assert.match(items[0].value.content,/function excerpt/);
  assert.match(items[0].value.sha256,/^[0-9a-f]{64}$/);
  assert.equal(items[0].from_test,"unicode-search.test.cjs");
  assert.equal(items[0].edge_status,"LEXICAL_SINGLE_CANDIDATE");
  assert.deepEqual(actual.scope.dependency_candidate_paths,["src/offset.js"]);
  assert.equal(actual.scope.dependency_coverage,"PARTIAL_HEURISTIC_NOT_CALL_PROOF");
  assert.equal(actual.scope.coverage,"PARTIAL");
  assert.deepEqual(actual.scope.source_paths,source.scope.source_paths);
 });
});
test("direct import expansion cannot expose protected or symlink files",()=>{
 fixture(root=>{
  fs.mkdirSync(path.join(root,"secrets"));
  fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node --test case.test.cjs"}}));
  fs.writeFileSync(path.join(root,"case.test.cjs"),'require("./secrets/key.js"); require("./external.js");\n');
  fs.writeFileSync(path.join(root,"secrets/key.js"),"NEVER_EXPOSE_SECRET");
  fs.symlinkSync(path.join(root,"secrets/key.js"),path.join(root,"external.js"));
  const initial=initialInvestigationEvidence(root,{request:"Investigate test",checks:[]});
  const actual=addBoundedTestDependencyEvidence(root,initial);
  assert.equal(actual.records.filter(x=>x.kind==="initial_dependency_candidate").length,0);
  assert.deepEqual(actual,initial);
  assert.doesNotMatch(JSON.stringify(actual),/NEVER_EXPOSE_SECRET/);
 });
});
test("bounded first-hop candidate selection never traverses transitive dependencies",()=>{
 fixture(root=>{
  fs.writeFileSync(path.join(root,"package.json"),JSON.stringify({scripts:{test:"node --test first.test.cjs"}}));
  fs.writeFileSync(path.join(root,"first.test.cjs"),'require("./a.js"); require("./b.js"); require("./c.js");\n');
  fs.writeFileSync(path.join(root,"a.js"),'require("./deep.js"); module.exports=1;\n');
  for(const name of ["b.js","c.js","deep.js"])fs.writeFileSync(path.join(root,name),"module.exports=1;\n");
  const initial=initialInvestigationEvidence(root,{request:"test",checks:[]});
  const actual=addBoundedTestDependencyEvidence(root,initial);
  assert.equal(actual.records.filter(x=>x.kind==="initial_dependency_candidate").length,2);
  assert.equal(actual.scope.dependency_candidate_paths.includes("deep.js"),false);
  assert.equal(actual.records.length,initial.records.length+2);
 });
});
