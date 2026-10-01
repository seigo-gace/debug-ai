"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {ROLE_ORDER,validateBenchmarkResult,runSkillEffectSuite}=require("../control/skill-effect-suite.js");

function result(role,on=10,off=8,max=15){return{completed:true,role,score:{skill_on:on,skill_off:off,max,delta:on-off,winner:on>off?"SKILL_ON":on<off?"SKILL_OFF":"TIE",effect_demonstrated:on>off}};}
function runners(factory){return Object.fromEntries(ROLE_ORDER.map(role=>[role,()=>factory(role)]));}

test("six-role suite measures every role sequentially without forcing Skill ON",async()=>{
  const seen=[];
  const suite=await runSkillEffectSuite({runners:Object.fromEntries(ROLE_ORDER.map((role,index)=>[role,async()=>{seen.push(role);return index===1?result(role,7,9,15):index===2?result(role,8,8,15):result(role,10,8,15);}]))});
  assert.deepEqual(seen,ROLE_ORDER);
  assert.equal(suite.completed,true);
  assert.equal(suite.production_promotion_authorized,false);
  assert.deepEqual(suite.summary,{roles_total:6,roles_measured:6,roles_incomplete:0,skill_on_better:4,skill_off_better:1,ties:1});
  assert.equal(suite.results[1].result.score.winner,"SKILL_OFF");
  assert.equal(suite.results[2].result.score.winner,"TIE");
});

test("one missing or failing role keeps the whole suite incomplete while preserving measured roles",async()=>{
  const map=runners(role=>result(role));delete map.researcher;map.diagnoser=async()=>{throw new Error("AI_CORE_TIMEOUT")};
  const suite=await runSkillEffectSuite({runners:map});
  assert.equal(suite.completed,false);
  assert.equal(suite.qualification,"INCOMPLETE");
  assert.equal(suite.summary.roles_measured,4);
  assert.equal(suite.summary.roles_incomplete,2);
  assert.equal(suite.results.find(x=>x.role==="researcher").error_code,"RUNNER_MISSING");
  assert.match(suite.results.find(x=>x.role==="diagnoser").error_code,/AI_CORE_TIMEOUT/);
});

test("suite rejects inconsistent benchmark scores instead of manufacturing a winner",()=>{
  assert.throws(()=>validateBenchmarkResult("code_scout",{completed:true,role:"code_scout",score:{skill_on:10,skill_off:8,max:15,delta:9,winner:"SKILL_ON"}}),/SCORE_INCONSISTENT/);
  assert.throws(()=>validateBenchmarkResult("code_scout",{completed:true,role:"code_scout",score:{skill_on:7,skill_off:9,max:15,delta:-2,winner:"SKILL_ON"}}),/WINNER_INVALID/);
});
