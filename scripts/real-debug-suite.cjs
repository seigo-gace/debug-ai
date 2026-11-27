"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const corpus=require("./real-debug-corpus.json");
const digest=s=>crypto.createHash("sha256").update(s).digest("hex");
function testSource(checks){return '"use strict";\nconst assert=require("node:assert/strict"),api=require("./src/index.cjs");\n(async()=>{\n'+checks.map((x,i)=>'{ // check '+(i+1)+'\n'+x+';\n}').join('\n')+'\n})().catch(e=>{console.error(e);process.exitCode=1});\n';}
function payload(c,{reference=false,holdout=false}={}){
 const files=reference?c.oracle.reference_files:c.files;
 return {...files,"package.json":JSON.stringify({name:"debug-case",version:"1.0.0",private:true,scripts:{test:"node reproduce.cjs"}})+"\n","README.md":c.contract+"\n","reproduce.cjs":testSource(holdout?c.holdout_checks:c.public_checks)};
}
function writeNew(root,files){
 fs.mkdirSync(root,{recursive:false,mode:0o755});
 for(const [rel,body] of Object.entries(files)){
  if(!/^(?:src\/[a-z]+\.cjs|package\.json|README\.md|reproduce\.cjs)$/.test(rel))throw Error("FIXTURE_PATH_INVALID");
  const dst=path.join(root,rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,body,{flag:"wx",mode:0o644});
 }
}
function fixtureCheck(c,root){
 const runs={};
 for(const [name,ref,hidden] of [["bug_public",false,false],["fix_public",true,false],["bug_holdout",false,true],["fix_holdout",true,true]]){
  const d=path.join(root,c.id+"-"+name);writeNew(d,payload(c,{reference:ref,holdout:hidden}));
  const r=spawnSync(process.execPath,["reproduce.cjs"],{cwd:d,encoding:"utf8",timeout:3000,env:{PATH:process.env.PATH||""}});
  runs[name]={exit:r.status,signal:r.signal,timeout:r.error?.code==="ETIMEDOUT",assertion:/AssertionError/.test(r.stderr||""),stderr:(r.stderr||"").slice(0,700)};
 }
 const failed=x=>x.exit!==0&&!x.timeout&&!x.signal&&x.assertion;
 return {id:c.id,level:c.level,pass:failed(runs.bug_public)&&failed(runs.bug_holdout)&&runs.fix_public.exit===0&&runs.fix_holdout.exit===0,runs};
}
function select(id){const c=corpus.cases.find(c=>c.id===id);if(!c)throw Error("CASE_NOT_FOUND");return c;}
module.exports={corpus,digest,testSource,payload,writeNew,fixtureCheck,select};
