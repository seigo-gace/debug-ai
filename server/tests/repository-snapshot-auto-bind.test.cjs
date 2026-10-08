"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {execFileSync}=require("node:child_process");
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

function realRepo(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-snapshot-content-"));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync("git",["-C",root,...args],{encoding:"utf8"});
  git("init","-q");fs.writeFileSync(path.join(root,"source.js"),"module.exports=0;\n");git("add","source.js");
  git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-qm","baseline");
  return{root,git,file:path.join(root,"source.js")};
}

test("dirty tracked source bytes cannot share a repository snapshot merely because status is unchanged",t=>{
  const f=realRepo(t);fs.writeFileSync(f.file,"module.exports=1;\n");
  const first=repositorySnapshotId(f.root),status=f.git("status","--porcelain=v1","--untracked-files=no");
  fs.writeFileSync(f.file,"module.exports=2;\n");
  assert.equal(f.git("status","--porcelain=v1","--untracked-files=no"),status);
  assert.notEqual(repositorySnapshotId(f.root),first);
});

test("staged and mixed tracked changes bind actual bytes and file modes",t=>{
  const f=realRepo(t);fs.writeFileSync(f.file,"module.exports=1;\n");f.git("add","source.js");
  const staged=repositorySnapshotId(f.root);fs.writeFileSync(f.file,"module.exports=2;\n");
  const mixed=repositorySnapshotId(f.root);assert.notEqual(mixed,staged);
  fs.writeFileSync(f.file,"module.exports=3;\n");assert.notEqual(repositorySnapshotId(f.root),mixed);
  const bytes=repositorySnapshotId(f.root);fs.chmodSync(f.file,0o755);assert.notEqual(repositorySnapshotId(f.root),bytes);
});

test("clean Git snapshot identity remains compatible and untracked-only changes remain excluded",t=>{
  const f=realRepo(t),head=f.git("rev-parse","HEAD").trim(),status=f.git("status","--porcelain=v1","--untracked-files=no");
  const expected=`git_${contentHash({head,status})}`;assert.equal(repositorySnapshotId(f.root),expected);
  fs.writeFileSync(path.join(f.root,"untracked.js"),"temporary");assert.equal(repositorySnapshotId(f.root),expected);
});

test("snapshot content read disables configured external diff and fails closed on byte budget exhaustion",t=>{
  const f=realRepo(t),marker=path.join(f.root,"external-diff-called");
  const script=path.join(f.root,"external-diff.sh");fs.writeFileSync(script,`#!/bin/sh\ntouch '${marker}'\necho untrusted\n`);fs.chmodSync(script,0o755);
  f.git("config","diff.external",script);fs.writeFileSync(f.file,"module.exports=42;\n");
  assert.match(repositorySnapshotId(f.root),/^git_/);assert.equal(fs.existsSync(marker),false);
  assert.throws(()=>repositorySnapshotId(f.root,{maxTotalBytes:2}),/DURABLE_REPO_SNAPSHOT_UNAVAILABLE/);
});
