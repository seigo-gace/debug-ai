"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {repositorySnapshotId}=require("../control/repository-snapshot.js");

function unavailableGit(){const error=new Error("git unavailable");error.code="ENOENT";throw error;}
function makeTree({gitMarker="directory"}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-tree-snapshot-"));
  if(gitMarker==="directory")fs.mkdirSync(path.join(root,".git"));
  else if(gitMarker==="file")fs.writeFileSync(path.join(root,".git"),"gitdir: /host/unavailable/worktree\n");
  fs.mkdirSync(path.join(root,"src"));fs.writeFileSync(path.join(root,"src","a.js"),"one\n");
  return{root,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function treeSnapshot(root,options={}){return repositorySnapshotId(root,{execFileSyncImpl:unavailableGit,...options});}

test("git available preserves git snapshot prefix",()=>{
  const fixture=makeTree(),execFileSyncImpl=(_command,args)=>args.includes("rev-parse")?`${"a".repeat(40)}\n`:" M src/a.js\n";
  try{assert.match(repositorySnapshotId(fixture.root,{execFileSyncImpl}),/^git_[a-f0-9]{64}$/);}finally{fixture.cleanup();}
});

test("git unavailable uses deterministic tree snapshot and detects source byte changes",()=>{
  const fixture=makeTree();
  try{const first=treeSnapshot(fixture.root);assert.match(first,/^tree_[a-f0-9]{64}$/);fs.writeFileSync(path.join(fixture.root,"src","a.js"),"two\n");assert.notEqual(treeSnapshot(fixture.root),first);}
  finally{fixture.cleanup();}
});

test("runtime and build artifacts are excluded from tree snapshot",()=>{
  const fixture=makeTree();
  try{
    fs.mkdirSync(path.join(fixture.root,"runtime"));fs.writeFileSync(path.join(fixture.root,"runtime","state.json"),"one");fs.mkdirSync(path.join(fixture.root,"build"));fs.writeFileSync(path.join(fixture.root,"build","addon.node"),"one");
    const first=treeSnapshot(fixture.root);fs.writeFileSync(path.join(fixture.root,"runtime","state.json"),"two");fs.writeFileSync(path.join(fixture.root,"build","addon.node"),"two");assert.equal(treeSnapshot(fixture.root),first);
  }finally{fixture.cleanup();}
});

test("runtime input queues are excluded from tree snapshot",()=>{
  const fixture=makeTree();
  try{
    fs.mkdirSync(path.join(fixture.root,".debugai-input"));
    fs.writeFileSync(path.join(fixture.root,".debugai-input","queue.json"),"one\n");
    const first=treeSnapshot(fixture.root);
    fs.writeFileSync(path.join(fixture.root,".debugai-input","queue.json"),"two\n");
    assert.equal(treeSnapshot(fixture.root),first);
  }finally{fixture.cleanup();}
});

test("symlink target text changes snapshot without following the link",()=>{
  const fixture=makeTree();
  try{fs.writeFileSync(path.join(fixture.root,"src","b.js"),"same\n");fs.symlinkSync("a.js",path.join(fixture.root,"src","link.js"));const first=treeSnapshot(fixture.root);fs.unlinkSync(path.join(fixture.root,"src","link.js"));fs.symlinkSync("b.js",path.join(fixture.root,"src","link.js"));assert.notEqual(treeSnapshot(fixture.root),first);}
  finally{fixture.cleanup();}
});

test("git pointer file permits fallback without hashing host-specific pointer content",()=>{
  const fixture=makeTree({gitMarker:"file"});
  try{const first=treeSnapshot(fixture.root);fs.writeFileSync(path.join(fixture.root,".git"),"gitdir: /different/host/path\n");assert.equal(treeSnapshot(fixture.root),first);}
  finally{fixture.cleanup();}
});

test("missing git marker fails closed",()=>{
  const fixture=makeTree();
  try{fs.rmSync(path.join(fixture.root,".git"),{recursive:true,force:true});assert.throws(()=>treeSnapshot(fixture.root),error=>error.message==="DURABLE_REPO_SNAPSHOT_UNAVAILABLE"&&error.cause?.code==="ENOENT");}
  finally{fixture.cleanup();}
});



test("explicit allowMissingGitMarker permits deterministic policy-bound tree snapshot",()=>{
  const fixture=makeTree();
  try{
    fs.rmSync(path.join(fixture.root,".git"),{recursive:true,force:true});
    const first=treeSnapshot(fixture.root,{allowMissingGitMarker:true});
    assert.match(first,/^tree_[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(fixture.root,"src","a.js"),"two\n");
    assert.notEqual(treeSnapshot(fixture.root,{allowMissingGitMarker:true}),first);
  }finally{fixture.cleanup();}
});

test("unsupported special file fails closed",()=>{
  const fixture=makeTree();
  try{
    const original=fs.lstatSync.bind(fs),fsImpl=Object.create(fs);fsImpl.lstatSync=file=>file===path.join(fixture.root,"src","a.js")?{isDirectory:()=>false,isFile:()=>false,isSymbolicLink:()=>false}:original(file);
    assert.throws(()=>treeSnapshot(fixture.root,{fsImpl}),error=>error.message==="DURABLE_REPO_SNAPSHOT_UNAVAILABLE"&&String(error.cause?.message).includes("UNSUPPORTED_FILE"));
  }
  finally{fixture.cleanup();}
});

test("unreadable source file fails closed",()=>{
  const fixture=makeTree();
  try{
    const fsImpl=Object.create(fs);fsImpl.readFileSync=()=>{const error=new Error("unreadable");error.code="EACCES";throw error;};
    assert.throws(()=>treeSnapshot(fixture.root,{fsImpl}),error=>error.message==="DURABLE_REPO_SNAPSHOT_UNAVAILABLE"&&error.cause?.code==="EACCES");
  }finally{fixture.cleanup();}
});

test("out-of-tree symlink target fails closed",()=>{
  const fixture=makeTree();
  try{fs.symlinkSync("../../outside",path.join(fixture.root,"src","escape"));assert.throws(()=>treeSnapshot(fixture.root),error=>error.message==="DURABLE_REPO_SNAPSHOT_UNAVAILABLE"&&String(error.cause?.message).includes("SYMLINK_TRAVERSAL"));}
  finally{fixture.cleanup();}
});

test("fixed entry and byte limits fail closed",()=>{
  const fixture=makeTree();
  try{
    assert.throws(()=>treeSnapshot(fixture.root,{maxFiles:1}),/DURABLE_REPO_SNAPSHOT_UNAVAILABLE/);
    assert.throws(()=>treeSnapshot(fixture.root,{maxTotalBytes:1}),/DURABLE_REPO_SNAPSHOT_UNAVAILABLE/);
  }finally{fixture.cleanup();}
});
