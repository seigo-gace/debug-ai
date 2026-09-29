"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {execFileSync}=require("node:child_process");
const {tryRepositorySnapshotId}=require("../run-authority.js");

function git(repo,...args){return execFileSync("git",["-C",repo,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();}
function makeRepo(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-revision-gate-"));git(root,"init");git(root,"config","user.email","debugai@example.invalid");git(root,"config","user.name","DebugAI Test");fs.writeFileSync(path.join(root,"a.txt"),"one\n");git(root,"add","a.txt");git(root,"commit","-m","init");return{root,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};}

test("repository snapshot binds HEAD plus tracked worktree state while ignoring untracked-only changes",()=>{
  const fixture=makeRepo();
  try{
    const first=tryRepositorySnapshotId(fixture.root);
    assert.match(first,/^git_[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(fixture.root,"untracked.txt"),"ignored\n");
    assert.equal(tryRepositorySnapshotId(fixture.root),first);
    fs.writeFileSync(path.join(fixture.root,"a.txt"),"two\n");
    const dirty=tryRepositorySnapshotId(fixture.root);
    assert.match(dirty,/^git_[a-f0-9]{64}$/);
    assert.notEqual(dirty,first);
    git(fixture.root,"add","a.txt");git(fixture.root,"commit","-m","change");
    const second=tryRepositorySnapshotId(fixture.root);
    assert.match(second,/^git_[a-f0-9]{64}$/);
    assert.notEqual(second,first);
    assert.notEqual(second,dirty);
  }finally{fixture.cleanup();}
});

test("repository snapshot returns null outside a git repository",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-non-git-"));
  try{assert.equal(tryRepositorySnapshotId(root),null);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
