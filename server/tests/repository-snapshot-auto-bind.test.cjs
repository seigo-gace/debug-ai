"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
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
