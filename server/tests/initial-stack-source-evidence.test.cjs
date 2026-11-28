"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {observedStackLocations,initialInvestigationEvidence}=require("../control/read-only-tool-runtime.js");
test("initial evidence reads only source locations bound to real isolated failure and deduplicates complete source",t=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),"debug-stack-"));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));
 fs.mkdirSync(path.join(repo,"src"));fs.writeFileSync(path.join(repo,"src/a.js"),"const a=1;\nthrow Error('bad');\n");
 fs.writeFileSync(path.join(repo,"package.json"),JSON.stringify({scripts:{test:"node src/a.js"}}));
 fs.mkdirSync(path.join(repo,"secrets"));fs.writeFileSync(path.join(repo,"secrets/a.js"),"private\n");
 const id="JOB_"+"a".repeat(24),prefix="/sandbox-jobs/jobs/"+id+"/repo/";
 const stderr="Error: bad\n at run ("+prefix+"src/a.js:2:1)\n at run ("+prefix+"src/a.js:2:1)\n at bad (/etc/a.js:1:1)\n at bad ("+prefix+"secrets/a.js:1:1)\n at bad ("+prefix+"../src/a.js:1:1)";
 const check={executed:true,status:"FAIL",timed_out:false,stderr,sandbox:{backend:"sidecar+landlock+seccomp",job_id:id}};
 const frames=observedStackLocations(repo,[check]);assert.equal(frames.length,1);assert.equal(frames[0].path,"src/a.js");assert.equal(frames[0].line,2);assert.match(frames[0].excerpt,/throw Error/);
 assert.equal(observedStackLocations(repo,[{...check,timed_out:true}]).length,0);
 const initial=initialInvestigationEvidence(repo,{failure:{source_paths:["src/a.js"]},checks:[check]});
 assert.equal(initial.scope.stack_location_count,1);const item=initial.records.find(r=>r.kind==="initial_stack_location");assert.equal(item.value.excerpt_in,"initial_source");assert.equal(item.value.excerpt,undefined);
});
test("python stack records preserve original line and never open outside source",t=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),"debug-stack-py-"));t.after(()=>fs.rmSync(repo,{recursive:true,force:true}));fs.writeFileSync(path.join(repo,"main.py"),"x=1\nraise Exception()\n");
 const check={executed:true,status:"FAIL",stderr:'  File "main.py", line 2, in <module>\n  File "/tmp/elsewhere.py", line 1, in <module>',sandbox:{backend:"sidecar+landlock+seccomp",job_id:"JOB_"+"b".repeat(24)}};
 const frames=observedStackLocations(repo,[check]);assert.equal(frames.length,1);assert.equal(frames[0].line,2);assert.equal(frames[0].column,null);
});