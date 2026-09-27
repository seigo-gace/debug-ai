"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {RepoPolicy}=require("../repo-policy.js");
const {createReadOnlyToolRuntime}=require("../control/read-only-tool-runtime.js");

function fixture(){
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-symbol-"));
  const repo=path.join(workspace,"repo");fs.mkdirSync(repo);
  const a=path.join(repo,"a.js"),b=path.join(repo,"b.js");
  fs.writeFileSync(a,'const {beta}=require("./b.js");\nfunction alpha(){return beta()}\nmodule.exports={alpha};\n');
  fs.writeFileSync(b,'function beta(){return 1}\nmodule.exports={beta};\n');
  return {workspace,repo,a,b,cleanup:()=>fs.rmSync(workspace,{recursive:true,force:true})};
}

test("symbol.lookup reuses read-only LSP boundary and only returns repo-local locations",async()=>{
  const f=fixture();try{
    const events=[];
    const lspFactory=({rootDir})=>({
      start:async()=>{events.push(["start",rootDir]);},
      open:(file,language)=>events.push(["open",file,language]),
      definition:async()=>[
        {path:f.b,range:{start:{line:0,character:9},end:{line:0,character:13}}},
        {path:path.join(os.tmpdir(),"outside.js"),range:null}
      ],
      references:async()=>[{path:f.a,range:null},{path:f.b,range:null}],
      documentSymbols:async()=>[{name:"alpha",kind:12,range:{start:{line:1,character:0},end:{line:1,character:31}},selectionRange:{start:{line:1,character:9},end:{line:1,character:14}}}],
      stop:async()=>{events.push(["stop"]);}
    });
    const runtime=createReadOnlyToolRuntime({repo:f.repo,repoPolicy:new RepoPolicy({workspaceRoot:f.workspace}),lspFactory});
    assert.ok(runtime.availableTools.includes("symbol.lookup"));
    const def=await runtime.execute({role:"code_scout",selectedSkillIds:["source-call-path-trace"],tool:"symbol.lookup",arguments:{path:"a.js",symbol:"beta",mode:"definition"}});
    assert.equal(def.status,"OK");
    assert.equal(def.data.locations.length,1);
    assert.equal(def.data.locations[0].path,"b.js");
    assert.equal(def.data.outside_repo_omitted,1);
    assert.match(def.evidence_id,/^TRE_[a-f0-9]{24}$/);
    assert.deepEqual(events[0],["start",fs.realpathSync(f.repo)]);
    assert.equal(events.at(-1)[0],"stop");
  }finally{f.cleanup();}
});

test("symbol.lookup supports references and document symbols with bounded output",async()=>{
  const f=fixture();try{
    const lspFactory=()=>({
      start:async()=>{},open:()=>{},
      definition:async()=>[],
      references:async()=>[{path:f.a,range:null},{path:f.b,range:null}],
      documentSymbols:async()=>[{name:"alpha",kind:12,range:null,selectionRange:null,children:[{name:"nested",kind:13,range:null,selectionRange:null}]}],
      stop:async()=>{}
    });
    const runtime=createReadOnlyToolRuntime({repo:f.repo,repoPolicy:new RepoPolicy({workspaceRoot:f.workspace}),lspFactory});
    const refs=await runtime.execute({role:"code_scout",selectedSkillIds:["source-call-path-trace"],tool:"symbol.lookup",arguments:{path:"a.js",symbol:"alpha",mode:"references"}});
    assert.deepEqual(refs.data.locations.map(x=>x.path),["a.js","b.js"]);
    const symbols=await runtime.execute({role:"code_scout",selectedSkillIds:["source-call-path-trace"],tool:"symbol.lookup",arguments:{path:"a.js",mode:"document_symbols"}});
    assert.deepEqual(symbols.data.symbols.map(x=>x.name),["alpha","nested"]);
  }finally{f.cleanup();}
});

test("symbol.lookup rejects unsupported language, invalid mode, and protected path",async()=>{
  const f=fixture();try{
    fs.writeFileSync(path.join(f.repo,"note.md"),"# alpha\n");
    fs.writeFileSync(path.join(f.repo,".env"),"SECRET=x\n");
    const runtime=createReadOnlyToolRuntime({repo:f.repo,repoPolicy:new RepoPolicy({workspaceRoot:f.workspace}),lspFactory:()=>{throw new Error("SHOULD_NOT_START")}});
    await assert.rejects(()=>runtime.execute({role:"code_scout",selectedSkillIds:["source-call-path-trace"],tool:"symbol.lookup",arguments:{path:"note.md",symbol:"alpha"}}),/SYMBOL_LANGUAGE_UNSUPPORTED/);
    await assert.rejects(()=>runtime.execute({role:"code_scout",selectedSkillIds:["source-call-path-trace"],tool:"symbol.lookup",arguments:{path:"a.js",symbol:"alpha",mode:"write"}}),/SYMBOL_MODE_INVALID/);
    await assert.rejects(()=>runtime.execute({role:"code_scout",selectedSkillIds:["source-call-path-trace"],tool:"symbol.lookup",arguments:{path:".env",symbol:"SECRET"}}),/READ_PROTECTED_PATH/);
  }finally{f.cleanup();}
});
