"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {CASES,buildSystems,withoutSkillDirectives,scoreCase,runSkillEffectBenchmark}=require("../control/skill-effect-benchmark.js");

test("Skill benchmark control removes only skill directives while preserving role policy",()=>{
  const systems=buildSystems();
  assert.match(systems.on,/ROLE=local_reviewer/);
  assert.match(systems.on,/SKILL_SELECTION=RUNTIME_FIXED/);
  assert.match(systems.on,/SELECTED_SKILLS=/);
  assert.match(systems.off,/ROLE=local_reviewer/);
  assert.doesNotMatch(systems.off,/SKILL_SELECTION=/);
  assert.doesNotMatch(systems.off,/SELECTED_SKILLS=/);
  assert.match(systems.off,/CLAIM_POLICY=/);
  assert.match(systems.off,/OUTPUT_SCHEMA=debugai\.review\/v2/);
  assert.equal(withoutSkillDirectives(systems.on),systems.off);
});

test("Skill benchmark deterministic scorer rewards correct evidence-bound outcomes",()=>{
  const supported=CASES.find(x=>x.id==="supported_completion");
  const rejected=CASES.find(x=>x.id==="false_completion");
  const insufficient=CASES.find(x=>x.id==="insufficient_verification");
  assert.equal(scoreCase(supported,{benchmark_verdict:"SUPPORTED",evidence_refs:["EV_TEST_PASS","EV_INVARIANT_PASS"],unsupported_claims:[],false_completions:[]}).score,5);
  assert.equal(scoreCase(rejected,{benchmark_verdict:"REJECTED",evidence_refs:["EV_REGRESSION_FAIL"],unsupported_claims:[],false_completions:["completion contradicted by failing regression"]}).score,5);
  assert.equal(scoreCase(insufficient,{benchmark_verdict:"INSUFFICIENT",evidence_refs:["EV_REGRESSION_NOT_RUN"],unsupported_claims:[],false_completions:[]}).score,5);
  assert.ok(scoreCase(rejected,{benchmark_verdict:"SUPPORTED",evidence_refs:["EV_FAKE"],unsupported_claims:[],false_completions:[]}).score<5);
});

test("Skill ON OFF benchmark uses identical cases and reports measured score delta without forcing a winner",async()=>{
  const calls=[];let tick=0;const clock={now(){tick+=10;return tick;}};
  const callModel=async({mode,system,user,case:testCase})=>{
    calls.push({mode,system,user,id:testCase.id});
    const on=mode==="on";
    const outputs={
      supported_completion:on?{benchmark_verdict:"SUPPORTED",evidence_refs:["EV_TEST_PASS","EV_INVARIANT_PASS"],unsupported_claims:[],false_completions:[]}:{benchmark_verdict:"SUPPORTED",evidence_refs:["EV_TEST_PASS"],unsupported_claims:[],false_completions:[]},
      false_completion:on?{benchmark_verdict:"REJECTED",evidence_refs:["EV_REGRESSION_FAIL"],unsupported_claims:[],false_completions:["completion contradicted"]}:{benchmark_verdict:"SUPPORTED",evidence_refs:["EV_UNIT_PASS"],unsupported_claims:[],false_completions:[]},
      insufficient_verification:on?{benchmark_verdict:"INSUFFICIENT",evidence_refs:["EV_REGRESSION_NOT_RUN"],unsupported_claims:[],false_completions:[]}:{benchmark_verdict:"SUPPORTED",evidence_refs:["EV_UNIT_PASS"],unsupported_claims:[],false_completions:[]},
    };
    return {content:JSON.stringify(outputs[testCase.id])};
  };
  const out=await runSkillEffectBenchmark({callModel,clock});
  assert.equal(out.completed,true);
  assert.equal(out.cases.length,3);
  assert.equal(calls.length,6);
  for(let i=0;i<calls.length;i+=2){assert.equal(calls[i].mode,"off");assert.equal(calls[i+1].mode,"on");assert.equal(calls[i].user,calls[i+1].user);}
  assert.equal(out.score.skill_on,15);
  assert.ok(out.score.skill_off<out.score.skill_on);
  assert.equal(out.score.winner,"SKILL_ON");
  assert.equal(out.score.effect_demonstrated,true);
});
