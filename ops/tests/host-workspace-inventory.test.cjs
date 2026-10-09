"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),cp=require("node:child_process");
const SCRIPT=path.resolve(__dirname,"../../scripts/host-workspace-inventory.py");
const command=(...argv)=>cp.execFileSync("git",argv,{stdio:"pipe",encoding:"utf8"});
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-inventory-"));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const projects=path.join(base,"projects"),worktrees=path.join(base,"worktrees");
  fs.mkdirSync(projects);fs.mkdirSync(worktrees);
  for(let i=0;i<9;i++)fs.mkdirSync(path.join(projects,"scratch-"+String(i).padStart(2,"0")));
  const repository=path.join(projects,"main-repository");
  command("init","-q",repository);
  fs.writeFileSync(path.join(repository,"README.md"),"fixture\n");
  command("-C",repository,"add","README.md");
  cp.execFileSync("git",["-C",repository,"-c","user.name=Fixture","-c","user.email=fixture@example.test","commit","-q","-m","fixture"]);
  const linked=path.join(worktrees,"feature-copy");
  command("-C",repository,"worktree","add","-q","-b","fixture-branch",linked);
  fs.symlinkSync(path.join(base,"outside"),path.join(projects,"symlink-out"));
  return{projects,worktrees,linked,repository};
}
function scan(f,page){
  const python=[
    "import json, runpy, sys",
    "from pathlib import Path",
    "module=runpy.run_path(sys.argv[1], run_name='inventory_test')",
    "print(json.dumps(module['inventory'](int(sys.argv[4]),(Path(sys.argv[2]),Path(sys.argv[3])))))",
  ].join("; ");
  return JSON.parse(cp.execFileSync("python3",["-c",python,SCRIPT,f.projects,f.worktrees,String(page)],{encoding:"utf8"}));
}
test("project inventory provides finite read-only pages across projects and linked Git worktrees",t=>{
  const f=fixture(t);
  const pages=[scan(f,0),scan(f,1),scan(f,2)];
  assert.equal(pages[0].schema,"debugai.host-workspace-inventory/v1");
  assert.equal(pages[0].total,12);
  assert.equal(pages[0].entries.length,6);
  assert.equal(pages[0].next_page,1);
  assert.equal(pages[1].next_page,null);
  const all=pages.slice(0,2).flatMap(p=>p.entries);
  assert.equal(all.length,12);
  const git=all.find(x=>x.name==="main-repository"),worktree=all.find(x=>x.name==="feature-copy");
  assert.equal(git.kind,"git_repository");
  assert.match(git.head,/^[a-f0-9]{12}$/);
  assert.match(git.last_commit,/fixture/);
  assert.equal(worktree.kind,"worktree_or_linked_git");
  assert.equal(worktree.branch,"fixture-branch");
  assert.equal(worktree.head,git.head);
  assert.ok(worktree.git_common_dir.includes("main-repository"));
  assert.equal(all.find(x=>x.name==="symlink-out").kind,"symlink");
  assert.equal(pages[2].entries.length,0);
  assert.equal(pages[2].next_page,null);
  assert.equal(fs.existsSync(path.join(f.linked,"README.md")),true);
});
test("inventory handles missing roots, never dereferences symlink and rejects invalid page",t=>{
  const f=fixture(t);
  const missing=path.join(f.projects,"nonexistent");
  const cmd=[
    "import json,runpy,sys",
    "from pathlib import Path",
    "m=runpy.run_path(sys.argv[1],run_name='inventory_test')",
    "print(json.dumps(m['inventory'](0,(Path(sys.argv[2]),))))",
  ].join("; ");
  const obj=JSON.parse(cp.execFileSync("python3",["-c",cmd,SCRIPT,missing],{encoding:"utf8"}));
  assert.deepEqual(obj.entries,[]);
  assert.deepEqual(obj.missing_roots,[missing]);
  assert.throws(()=>scan(f,-1));
  assert.ok(Buffer.byteLength(JSON.stringify(scan(f,0)))<=4096);
});
