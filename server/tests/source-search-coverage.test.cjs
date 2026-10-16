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

test("Unicode lowercase expansion before a hit preserves the original matching excerpt",t=>{
  const original="İ".repeat(900)+"\nUnique_Target_Marker\nend";
  const repo=fixture(t,{"unicode.js":original}),coverage={};
  const hits=searchSource(repo,"unique_target_marker",{coverage});
  assert.equal(hits.length,1);assert.ok(hits[0].excerpt.includes("Unique_Target_Marker"));
  assert.ok(original.includes(hits[0].excerpt));
  assert.equal(hits[0].sha256,require("node:crypto").createHash("sha256").update(original).digest("hex"));
  assert.equal(coverage.state,"COMPLETE_WITHIN_SEARCH_SCOPE");
});
test("astral source positions and expanding case mappings retain independent late hits",t=>{
  const original="😀İ".repeat(500)+"Late_Needle";
  const repo=fixture(t,{"astral.js":original});
  const hits=searchSource(repo,"late_needle");
  assert.equal(hits.length,1);assert.ok(hits[0].excerpt.includes("Late_Needle"));assert.ok(original.includes(hits[0].excerpt));
});
test("case-expanding queries preserve existing lowercase substring semantics and source case",t=>{
  const original="İ".repeat(900)+"Original_İ_Marker";
  const repo=fixture(t,{"folded.js":original});
  const hits=searchSource(repo,"ORIGINAL_i\u0307_MARKER");
  assert.equal(hits.length,1);assert.ok(hits[0].excerpt.includes("Original_İ_Marker"));assert.ok(original.includes(hits[0].excerpt));
  assert.equal(searchSource(repo,"original_i_marker").length,0);
});
test("a Unicode-correct search hit still discloses source truncation",t=>{
  const original="İ".repeat(900)+"Original_Needle"+"x".repeat(130000);
  const repo=fixture(t,{"truncated.js":original}),coverage={};
  const hits=searchSource(repo,"original_needle",{coverage});
  assert.equal(hits.length,1);assert.ok(hits[0].excerpt.includes("Original_Needle"));
  assert.equal(hits[0].truncated,true);assert.equal(coverage.state,"INCOMPLETE");assert.equal(coverage.repository_absence_proven,false);
});
