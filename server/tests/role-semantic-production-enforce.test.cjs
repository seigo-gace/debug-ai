"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {parseAndValidateRoleOutput,getSemanticShadow}=require("../control/role-output-validator.js");
const {currentRoleSemanticMode,withRoleSemanticMode}=require("../control/role-semantic-mode.js");
const {createWorkflow}=require("../workflow-observed.js");

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

test("base role validation remains shadow outside production semantic context",()=>{
  const value=parseAndValidateRoleOutput("code_scout",JSON.stringify({facts:[],operations:[{path:"a.js"}]}));
  assert.equal(getSemanticShadow(value).status,"WARN");
  assert.equal(currentRoleSemanticMode(),"shadow");
});

test("semantic enforce context rejects role responsibility leaks",()=>{
  assert.throws(()=>withRoleSemanticMode("enforce",()=>parseAndValidateRoleOutput("code_scout",JSON.stringify({facts:[],operations:[{path:"a.js"}]}))),/ROLE_SEMANTIC_INVALID:code_scout:ROLE_MUTATION_OUTPUT_FORBIDDEN:operations/);
  const good=withRoleSemanticMode("enforce",()=>parseAndValidateRoleOutput("code_scout",JSON.stringify({facts:[],decision:"HANDOFF"})));
  assert.equal(getSemanticShadow(good).status,"PASS");
});

test("AsyncLocalStorage isolates concurrent semantic modes",async()=>{
  async function lane(mode,delay){return withRoleSemanticMode(mode,async()=>{await sleep(delay);return currentRoleSemanticMode();});}
  const [shadow,enforce]=await Promise.all([lane("shadow",20),lane("enforce",1)]);
  assert.equal(shadow,"shadow");assert.equal(enforce,"enforce");assert.equal(currentRoleSemanticMode(),"shadow");
});

test("observed production workflow rejects semantic role leak before downstream diagnosis",async()=>{
  const calls=[];
  const aiCore={call:async(role)=>{
    calls.push(role);
    if(role==="code_scout")return{content:JSON.stringify({facts:[],operations:[{path:"forbidden.js"}],decision:"HANDOFF"})};
    if(role==="causal_scout")return{content:JSON.stringify({candidates:[],decision:"HANDOFF"})};
    throw new Error(`UNEXPECTED_ROLE:${role}`);
  }};
  const workflow=createWorkflow({aiCore,evidenceSearch:{search:async()=>[]}});
  await assert.rejects(()=>workflow.runAnalysis({rawRequest:"inspect failure",failure:{message:"boom"},localEvidence:[]}),/ROLE_SEMANTIC_INVALID:code_scout:ROLE_MUTATION_OUTPUT_FORBIDDEN:operations/);
  assert.ok(calls.includes("code_scout"));
  assert.equal(calls.includes("researcher"),false);
  assert.equal(calls.includes("diagnoser"),false);
});

test("observed production workflow accepts responsibility-clean role outputs",async()=>{
  const counts=new Map();
  const aiCore={call:async(role)=>{const n=(counts.get(role)||0)+1;counts.set(role,n);
    if(role==="code_scout")return{content:JSON.stringify({facts:[],decision:"HANDOFF"})};
    if(role==="causal_scout")return{content:JSON.stringify({candidates:[],decision:"HANDOFF"})};
    if(role==="researcher")return{content:JSON.stringify({research_status:"INSUFFICIENT_EVIDENCE",answer:"UNKNOWN",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:null})};
    if(role==="diagnoser")return{content:JSON.stringify({hypothesis:"unknown",decision:"HANDOFF"})};
    throw new Error(`UNEXPECTED_ROLE:${role}`);
  }};
  const workflow=createWorkflow({aiCore,evidenceSearch:{search:async()=>[]}});
  const out=await workflow.runAnalysis({rawRequest:"inspect failure",failure:{message:"boom"},localEvidence:[]});
  assert.equal(out.diagnosis.hypothesis,"unknown");
  assert.equal(counts.get("researcher"),1);assert.equal(counts.get("diagnoser"),1);
});
