"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {repositorySnapshotId}=require("../control/repository-snapshot.js");
const {contentHash}=require("../../orchestrator/durable-contracts.js");
const {tryRepositorySnapshotId}=require("../run-authority.js");

function makeRepo(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-revision-gate-"));fs.mkdirSync(path.join(root,".git"));fs.writeFileSync(path.join(root,"a.txt"),"one\n");
  let head="a".repeat(40),committed="one\n";
  const execFileSyncImpl=(_command,args)=>args.includes("rev-parse")?`${head}\n`:fs.readFileSync(path.join(root,"a.txt"),"utf8")===committed?"":" M a.txt\n";
  return{root,options:{execFileSyncImpl},commit(){committed=fs.readFileSync(path.join(root,"a.txt"),"utf8");head="b".repeat(40);},cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test("repository snapshot binds HEAD plus tracked worktree state while ignoring untracked-only changes",()=>{
  const fixture=makeRepo();
  try{
    const first=tryRepositorySnapshotId(fixture.root,fixture.options);
    assert.match(first,/^git_[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(fixture.root,"untracked.txt"),"ignored\n");
    assert.equal(tryRepositorySnapshotId(fixture.root,fixture.options),first);
    fs.writeFileSync(path.join(fixture.root,"a.txt"),"two\n");
    const dirty=tryRepositorySnapshotId(fixture.root,fixture.options);
    assert.match(dirty,/^git_[a-f0-9]{64}$/);
    assert.notEqual(dirty,first);
    fixture.commit();
    const second=tryRepositorySnapshotId(fixture.root,fixture.options);
    assert.match(second,/^git_[a-f0-9]{64}$/);
    assert.notEqual(second,first);
    assert.notEqual(second,dirty);
  }finally{fixture.cleanup();}
});

test("repository snapshot returns null outside a git repository",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-non-git-"));
  try{assert.equal(tryRepositorySnapshotId(root),null);}finally{fs.rmSync(root,{recursive:true,force:true});}
});

function bindingRepo(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-snapshot-binding-")),file=path.join(root,"source.js");
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,".git"));
  const baseline="module.exports=0;\n";fs.writeFileSync(file,baseline);let mode=0o644;
  const git=(...args)=>{if(args[0]==="rev-parse")return "a".repeat(40)+"\n";if(args[0]==="status")return fs.readFileSync(file,"utf8")===baseline&&mode===0o644?"":" M source.js\n";return "";};
  const execFileSyncImpl=(command,args,options)=>{
    assert.equal(command,"git");
    if(args.includes("diff")){
      for(const flag of ["--binary","--no-ext-diff","--no-textconv","--submodule=diff"])assert.ok(args.includes(flag));
      const evidence=JSON.stringify({tracked_content:fs.readFileSync(file,"utf8"),mode});
      if(Buffer.byteLength(evidence)>options.maxBuffer)throw new Error("fixture diff exceeds byte budget");
      return evidence;
    }
    return git(...args.slice(2));
  };
  return{root,file,git,setMode:()=>{mode=0o755;},snapshot:options=>repositorySnapshotId(root,{execFileSyncImpl,...options})};
}

test("dirty tracked source bytes cannot share a repository snapshot merely because status is unchanged",t=>{
  const f=bindingRepo(t);fs.writeFileSync(f.file,"module.exports=1;\n");
  const first=f.snapshot(),status=f.git("status","--porcelain=v1","--untracked-files=no");
  fs.writeFileSync(f.file,"module.exports=2;\n");
  assert.equal(f.git("status","--porcelain=v1","--untracked-files=no"),status);
  assert.notEqual(f.snapshot(),first);
});

test("Git binding distinguishes changed content and file modes in command evidence",t=>{
  const f=bindingRepo(t);fs.writeFileSync(f.file,"module.exports=1;\n");f.git("add","source.js");
  const staged=f.snapshot();fs.writeFileSync(f.file,"module.exports=2;\n");
  const mixed=f.snapshot();assert.notEqual(mixed,staged);
  fs.writeFileSync(f.file,"module.exports=3;\n");assert.notEqual(f.snapshot(),mixed);
  const bytes=f.snapshot();f.setMode();assert.notEqual(f.snapshot(),bytes);
});

test("clean Git snapshot identity remains compatible and untracked-only changes remain excluded",t=>{
  const f=bindingRepo(t),head=f.git("rev-parse","HEAD").trim(),status=f.git("status","--porcelain=v1","--untracked-files=no");
  const expected=`git_${contentHash({head,status})}`;assert.equal(f.snapshot(),expected);
  fs.writeFileSync(path.join(f.root,"untracked.js"),"temporary");assert.equal(f.snapshot(),expected);
});

test("Git binding requires no external diff or textconv and fails closed on byte budget exhaustion",t=>{
  const f=bindingRepo(t),marker=path.join(f.root,"external-diff-called");
  const script=path.join(f.root,"external-diff.sh");fs.writeFileSync(script,`#!/bin/sh\ntouch '${marker}'\necho untrusted\n`,{mode:0o755});
  f.git("config","diff.external",script);fs.writeFileSync(f.file,"module.exports=42;\n");
  assert.match(f.snapshot(),/^git_/);assert.equal(fs.existsSync(marker),false);
  assert.throws(()=>f.snapshot({maxTotalBytes:2}),/DURABLE_REPO_SNAPSHOT_UNAVAILABLE/);
});
