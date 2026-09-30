"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {CASES,buildSystems,scoreCase,runCodeScoutSkillEffectBenchmark}=require("../control/code-scout-skill-effect-benchmark.js");

test("Code Scout benchmark control removes only skill directives",()=>{
  const systems=buildSystems();
  assert.match(systems.on,/ROLE=code_scout/);
  assert.match(systems.on,/SKILL_SELECTION=RUNTIME_FIXED/);
  assert.match(systems.on,/SELECTED_SKILLS=/);
  assert.match(systems.off,/ROLE=code_scout/);
  assert.doesNotMatch(systems.off,/SKILL_SELECTION=/);
  assert.doesNotMatch(systems.off,/SELECTED_SKILLS=/);
  assert.match(systems.off,/CLAIM_POLICY=/);
  assert.match(systems.off,/OUTPUT_SCHEMA=debugai\.source-facts\/v1/);
});

test("Code Scout deterministic scorer rewards exact bounded source analysis",()=>{
  for(const c of CASES){
    const good={relevant_files:c.expected.relevant_files,call_path:c.expected.call_path,contract_mismatch:c.expected.mismatch,excluded_files:[c.expected.excluded_file],unknowns:[]};
    assert.equal(scoreCase(c,good).score,5,c.id);
  }
  const c=CASES[0];
  assert.ok(scoreCase(c,{relevant_files:[...c.expected.relevant_files,c.expected.excluded_file],call_path:[],contract_mismatch:null,excluded_files:[],unknowns:[]}).score<5);
});

test("Code Scout benchmark uses identical cases and does not force Skill ON winner",async()=>{
  let tick=0;const calls=[];const clock={now(){tick+=10;return tick;}};
  const callModel=async({mode,system,user,case:c})=>{calls.push({mode,system,user,id:c.id});const perfect={relevant_files:c.expected.relevant_files,call_path:c.expected.call_path,contract_mismatch:c.expected.mismatch,excluded_files:[c.expected.excluded_file],unknowns:[]};return {content:JSON.stringify(perfect)};};
  const out=await runCodeScoutSkillEffectBenchmark({callModel,clock});
  assert.equal(out.completed,true);assert.equal(out.cases.length,3);assert.equal(calls.length,6);
  for(let i=0;i<calls.length;i+=2){assert.equal(calls[i].mode,"off");assert.equal(calls[i+1].mode,"on");assert.equal(calls[i].user,calls[i+1].user);}
  assert.equal(out.score.skill_on,15);assert.equal(out.score.skill_off,15);assert.equal(out.score.winner,"TIE");assert.equal(out.score.effect_demonstrated,false);
});
