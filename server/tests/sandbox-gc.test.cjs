"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {gcSandboxJobs}=require("../control/sandbox-runtime.js");
const {nextJob}=require("../control/sandbox-sidecar.js");

function touch(file,ms){const d=new Date(ms);fs.utimesSync(file,d,d);}
function makeJob(jobs,name,{result=false,active=false,mtime}={}){const dir=path.join(jobs,name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"request.json"),JSON.stringify({schema:"fixture"}));if(result)fs.writeFileSync(path.join(dir,"result.json"),"{}");if(active)fs.writeFileSync(path.join(dir,".active"),"{}");if(mtime!==undefined){if(result)touch(path.join(dir,"result.json"),mtime);if(active)touch(path.join(dir,".active"),mtime);touch(dir,mtime);}return dir;}

test("sandbox GC removes only expired terminal/orphan/pending jobs and preserves active work",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-sandbox-gc-"));
  try{
    const jobs=path.join(root,"jobs");fs.mkdirSync(jobs,{recursive:true});const now=Date.now(),oldTerminal=now-7*3600e3,oldOrphan=now-31*60e3;
    const terminalOld=makeJob(jobs,"JOB_aaaaaaaaaaaaaaaaaaaaaaaa",{result:true,mtime:oldTerminal});
    const terminalFresh=makeJob(jobs,"JOB_bbbbbbbbbbbbbbbbbbbbbbbb",{result:true,mtime:now});
    const orphanOld=makeJob(jobs,"DAP_cccccccccccccccccccccccc",{mtime:oldOrphan});
    const activeFresh=makeJob(jobs,"JOB_dddddddddddddddddddddddd",{active:true,mtime:now});
    const pending=path.join(jobs,".pending-JOB_eeeeeeeeeeeeeeeeeeeeeeee");fs.mkdirSync(pending);touch(pending,oldOrphan);
    const report=gcSandboxJobs({jobRoot:root,now,terminalRetentionMs:6*3600e3,orphanGraceMs:30*60e3});
    assert.deepEqual(report,{terminal_removed:1,orphan_removed:1,pending_removed:1,active_skipped:1});
    assert.equal(fs.existsSync(terminalOld),false);assert.equal(fs.existsSync(orphanOld),false);assert.equal(fs.existsSync(pending),false);
    assert.equal(fs.existsSync(terminalFresh),true);assert.equal(fs.existsSync(activeFresh),true);
    assert.equal(nextJob(root),null);
    fs.unlinkSync(path.join(activeFresh,".active"));assert.equal(nextJob(root),activeFresh);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
