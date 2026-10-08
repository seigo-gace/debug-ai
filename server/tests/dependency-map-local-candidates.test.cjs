"use strict";
// Real read-only repository files + Code Scout tool admission; NOT model semantic proof.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const crypto=require("node:crypto");
const {createReadOnlyToolRuntime,assertToolResultIntegrity}=require("../control/read-only-tool-runtime-base.js");
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-dep-candidate-"));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,"repo");fs.mkdirSync(repo);fs.mkdirSync(path.join(repo,"src"));
 const write=(p,v)=>{fs.mkdirSync(path.dirname(path.join(repo,p)),{recursive:true});fs.writeFileSync(path.join(repo,p),v);};
 const tool=createReadOnlyToolRuntime({repo,repoPolicy:{assertRepo:x=>x}});
 const run=p=>tool.execute({role:"code_scout",selectedSkillIds:["source-call-path-trace"],tool:"dependency.map",arguments:{path:p}});
 return{root,repo,write,run};
}
test("Code Scout returns source-hash-bound local dependency candidate while preserving specifiers",async t=>{
 const f=fixture(t);f.write("src/entry.ts",'import {value} from "./helper";\nimport "@vendor/indirect";\n');f.write("src/helper.ts","export const value=7;\n");
 const result=await f.run("src/entry.ts");assert.equal(assertToolResultIntegrity(result),true);
 assert.deepEqual(result.data.specifiers,["./helper","@vendor/indirect"]);
 const hit=result.data.local_candidates.find(x=>x.specifier==="./helper");
 assert.equal(hit.status,"SINGLE_LOCAL_CANDIDATE");assert.equal(hit.path,"src/helper.ts");
 assert.equal(hit.sha256,crypto.createHash("sha256").update("export const value=7;\n").digest("hex"));
 assert.equal(result.data.local_candidates.find(x=>x.specifier==="@vendor/indirect").status,"NOT_LOCAL");
 assert.equal(result.data.coverage.repository_absence_proven,false);
 assert.match(result.data.coverage.scope,/LITERAL_RELATIVE_IMPORT/);
});
test("ambiguous, missing, escaped and symlink-backed paths never become verified edges",async t=>{
 const f=fixture(t);f.write("src/entry.js",'import "./duplicate";\nimport "./missing";\nimport "../../outside";\nimport "./escape";\n');
 f.write("src/duplicate.js","module.exports=1");f.write("src/duplicate.ts","export default 1");
 const outside=path.join(f.root,"outside.js");fs.writeFileSync(outside,"secret-do-not-read");
 fs.symlinkSync(outside,path.join(f.repo,"src","escape.js"));
 const out=(await f.run("src/entry.js")).data.local_candidates;
 assert.equal(out.find(x=>x.specifier==="./duplicate").status,"AMBIGUOUS_LOCAL_CANDIDATES");
 assert.equal(out.find(x=>x.specifier==="./missing").status,"UNRESOLVED_WITHIN_BOUNDED_SCOPE");
 assert.equal(out.find(x=>x.specifier==="../../outside").status,"BLOCKED_OUTSIDE_REPO");
 assert.equal(out.find(x=>x.specifier==="./escape").status,"BLOCKED_OR_UNVERIFIED");
 assert.ok(!JSON.stringify(out).includes("secret-do-not-read"));
});
test("truncated source remains INCOMPLETE, never an absent-dependency assertion",async t=>{
 const f=fixture(t);f.write("src/large.ts","x".repeat(100005)+'\nimport "./hidden";');
 const result=await f.run("src/large.ts");
 assert.equal(result.data.coverage.source_truncated,true);
 assert.equal(result.data.coverage.repository_absence_proven,false);
 assert.equal(result.data.coverage.state,"INCOMPLETE");
 assert.equal(assertToolResultIntegrity(result),true);
});

test("directory-index imports resolve as candidates but protected imports never expose data",async t=>{
 const f=fixture(t);f.write("src/entry.ts",'import "./package";\nimport "../secrets/password";\n');
 f.write("src/package/index.ts","export const nested=true;\n");f.write("secrets/password.ts","private-fixture-value");
 const result=await f.run("src/entry.ts");
 assert.equal(result.data.local_candidates.find(x=>x.specifier==="./package").status,"SINGLE_LOCAL_CANDIDATE");
 assert.equal(result.data.local_candidates.find(x=>x.specifier==="./package").path,"src/package/index.ts");
 assert.equal(result.data.local_candidates.find(x=>x.specifier==="../secrets/password").status,"BLOCKED_OR_UNVERIFIED");
 assert.equal(JSON.stringify(result).includes("private-fixture-value"),false);
});
