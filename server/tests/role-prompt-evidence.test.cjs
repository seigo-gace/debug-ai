"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {projectRolePrompt}=require("../control/role-prompt-evidence.js");
const views=[{evidence_id:"EVI_1",payload:{source:"a".repeat(3000),kind:"initial_source"}},{evidence_id:"EVI_2",payload:{stderr:"AssertionError "+ "b".repeat(1500),expected:1,actual:2}}];
const make=(task,structuredTask=true,criteria=null)=>projectRolePrompt({task:JSON.stringify(task),step:2,previousProgress:{remaining_work:["verify"],evidence_refs:["EVI_2"]},evidence:["EVI_1","EVI_2"],views,structuredTask,criteria});
test("horizontal scout prompt preserves every byte of evidence while removing repeated arrays and JSON string escaping",()=>{
 const task={task:"investigate",evidence:views,initial_scope:{coverage:"PARTIAL"},failure:{message:"bad"}};
 const p=make(task);assert.deepEqual(p.registered_evidence,views);assert.deepEqual(p.task.evidence.registered_evidence_refs,["EVI_1","EVI_2"]);assert.equal(p.task.failure.message,"bad");assert.equal(p.task.initial_scope.coverage,"PARTIAL");
 assert.deepEqual({...p.task,evidence:p.task.evidence.registered_evidence_refs.map(id=>p.registered_evidence.find(v=>v.evidence_id===id))},task);
 const old={task:JSON.stringify(task),registered_evidence:views,evidence:views,registered_evidence_ids:["EVI_1","EVI_2"],step:2,previous_progress:p.previous_progress};
 assert.ok(Buffer.byteLength(JSON.stringify(p))<Buffer.byteLength(JSON.stringify(old))*0.5);
});
test("different record content, arbitrary user strings, unrelated arrays, criteria and subset order are preserved",()=>{
 const task={task:"x",localEvidence:[views[1],views[0],views[1]],official:[{...views[0],payload:{source:"different"}}],unknown:["retain"],data:views};
 const p=make(task,true,[{id:"criterion1",evidence_id:"EVI_1"}]);
 assert.deepEqual(p.task.localEvidence.registered_evidence_refs,["EVI_2","EVI_1","EVI_2"]);assert.deepEqual(p.task.official,task.official);assert.deepEqual(p.task.data,task.data);assert.deepEqual(p.task.unknown,task.unknown);assert.deepEqual(p.criteria,[{id:"criterion1",evidence_id:"EVI_1"}]);
 const raw=make(task,false);assert.equal(raw.task,JSON.stringify(task));assert.deepEqual(raw.registered_evidence,views);
});
