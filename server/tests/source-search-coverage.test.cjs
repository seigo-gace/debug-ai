"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {searchSource,createReadOnlyToolRuntime,makeToolResult,assertToolResultIntegrity,evidenceProjection}=require("../control/read-only-tool-runtime-base.js");
function fixture(t,files){const repo=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-search-coverage-"));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));for(const [name,content] of Object.entries(files))fs.writeFileSync(path.join(repo,name),content);return repo;}
test("zero hits in truncated source remain incomplete coverage",t=>{
  const repo=fixture(t,{"a.js":"x".repeat(128001)+"needle"}),coverage={};
  assert.deepEqual(searchSource(repo,"needle",{coverage}),[]);
  assert.equal(coverage.state,"INCOMPLETE");assert.equal(coverage.truncated_files,1);
  assert.equal(coverage.repository_absence_proven,false);assert.deepEqual(coverage.inspected_paths,["a.js"]);
});
test("file and match limits disclose uninspected source without inventing hits",t=>{
  const repo=fixture(t,{"a.js":"needle","b.js":"needle","c.js":"needle"});
  for(const options of [{maxFiles:1},{limit:1}]){const coverage={};const hits=searchSource(repo,"needle",{...options,coverage});assert.equal(hits.length,1);assert.equal(coverage.state,"INCOMPLETE");assert.equal(coverage.inspected_paths.length,1);assert.equal(coverage.repository_absence_proven,false);}
});
test("fully read selected files and empty scoped search have explicit coverage",t=>{
  const repo=fixture(t,{"a.js":"alpha","b.py":"beta","excluded.bin":"needle"}),coverage={};
  assert.deepEqual(searchSource(repo,"needle",{coverage}),[]);
  assert.equal(coverage.state,"COMPLETE_WITHIN_SEARCH_SCOPE");assert.equal(coverage.inspected_paths.length,2);
  assert.equal(coverage.repository_absence_proven,false);assert.equal(coverage.scope,"SEARCHABLE_REGULAR_FILES_ONLY");
});
test("search receipts remain integrity-bound and visible through existing evidence projections",async t=>{
  const repo=fixture(t,{"a.js":"needle"}),runtime=createReadOnlyToolRuntime({repo,repoPolicy:{assertRepo:value=>value}});
  const result=await runtime.execute({role:"code_scout",selectedSkillIds:["failure-scope-reduction"],tool:"source.search",arguments:{query:"needle"}});
  assert.equal(result.data[0].path,"a.js");assert.equal(assertToolResultIntegrity(result),true);
  assert.equal(result.integrity.search_coverage.state,"COMPLETE_WITHIN_SEARCH_SCOPE");
  assert.match(evidenceProjection(result).excerpt,/search_coverage/);
  const tampered={...result,integrity:{...result.integrity,search_coverage:{...result.integrity.search_coverage,state:"FAKE_COMPLETE"}}};
  assert.throws(()=>assertToolResultIntegrity(tampered),/TOOL_RESULT_HASH_MISMATCH/);
  const legacy=makeToolResult("source.search",[]);assert.equal(assertToolResultIntegrity(legacy),true);assert.equal(Object.hasOwn(legacy.integrity,"search_coverage"),false);
  const context=runtime.createEvidenceContext({observations:[{results:[{result}]}]});
  const rehydrated=await runtime.execute({role:"diagnoser",selectedSkillIds:["hypothesis-falsification"],tool:"evidence.read",arguments:{evidence_id:result.evidence_id},evidenceContext:context});
  assert.match(rehydrated.data.excerpt,/COMPLETE_WITHIN_SEARCH_SCOPE/);
});
test("unreadable bounded source and compressed many-hit projections retain incomplete scope",t=>{
  const repo=fixture(t,{"large.js":"x".repeat(2*1024*1024),"small.js":"needle"}),coverage={};
  assert.equal(searchSource(repo,"needle",{coverage}).length,1);assert.equal(coverage.read_errors,1);assert.equal(coverage.state,"INCOMPLETE");
  const result=makeToolResult("source.search",Array.from({length:20},()=>({excerpt:"x".repeat(900)})),{searchCoverage:coverage});
  const projected=evidenceProjection(result,{maxChars:500});assert.match(projected.excerpt,/INCOMPLETE/);assert.match(projected.excerpt,/repository_absence_proven":false/);assert.equal(projected.projection_completeness,"PARTIAL");
  const {compileInvocation}=require("../control/invocation-compiler.js");
  assert.match(compileInvocation("code_scout").system,/Zero hits do not prove repository-wide absence/);
  assert.doesNotMatch(compileInvocation("causal_scout").system,/SEARCH_COVERAGE=/);
});
