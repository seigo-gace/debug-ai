"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {MAX_TOKENS,CASES,buildSystemsForCase,scoreCase,runDiagnoserSkillEffectBenchmark}=require("../control/diagnoser-skill-effect-benchmark.js");

function good(c){return{diagnosis_status:c.expected.diagnosis_status,hypotheses:c.expected.hypotheses.map(x=>({id:x.id,evidence_refs:[...x.evidence_refs],falsification_condition:x.falsification_condition,counter_evidence_refs:[...x.counter_evidence_refs],status:x.status})),confirmed_root_cause:c.expected.confirmed_root_cause,unsupported_claims:[...c.expected.unsupported_claims]};}

test("Diagnoser benchmark fixes falsification, refutation, rejection history, and insufficiency cases",()=>{
  assert.equal(MAX_TOKENS,600);
  assert.deepEqual(CASES.map(x=>x.id),["competing_falsifiable_hypotheses","cross_refutation","rejected_hypothesis_avoidance","correlation_insufficient"]);
  for(const c of CASES){const systems=buildSystemsForCase(c);assert.equal(systems.selected_skill_ids.length,3);assert.deepEqual(systems.selected_skill_ids,[...c.skills]);assert.match(systems.on,/SELECTED_SKILLS=/);assert.doesNotMatch(systems.off,/SELECTED_SKILLS=/);assert.match(systems.off,/ROLE=diagnoser/);assert.match(systems.off,/never expose raw chain-of-thought/i);}
});

test("Diagnoser deterministic scorer requires exact verifiable hypothesis artifacts",()=>{
  for(const c of CASES)assert.equal(scoreCase(c,good(c)).score,5,c.id);
  const competing=CASES[0];const missingFalsification=good(competing);missingFalsification.hypotheses[0].falsification_condition="";assert.ok(scoreCase(competing,missingFalsification).score<5);
  const fabricated=good(competing);fabricated.hypotheses[0].evidence_refs=["INVENTED_EVIDENCE"];assert.ok(scoreCase(competing,fabricated).score<5);
  const insufficient=CASES[3];const overclaim=good(insufficient);overclaim.confirmed_root_cause="H_DATABASE_LATENCY";overclaim.unsupported_claims=[];assert.ok(scoreCase(insufficient,overclaim).score<5);
});

test("Diagnoser benchmark keeps paired inputs identical and derives the winner",async()=>{
  const calls=[];const outputs=new Map();
  for(const c of CASES){outputs.set(`off:${c.id}`,JSON.stringify({diagnosis_status:"INSUFFICIENT_EVIDENCE",hypotheses:[],confirmed_root_cause:null,unsupported_claims:[]}));outputs.set(`on:${c.id}`,JSON.stringify(good(c)));}
  const result=await runDiagnoserSkillEffectBenchmark({callModel:async({mode,user})=>{const parsed=JSON.parse(user);calls.push({mode,user});return{content:outputs.get(`${mode}:${parsed.benchmark_case}`)};},clock:{now:(()=>{let n=0;return()=>++n;})()}});
  assert.equal(result.skill_selection_boundary,"MAX_3_PER_INVOCATION");assert.equal(result.score.skill_on,20);assert.ok(result.score.skill_off<20);assert.equal(result.score.winner,"SKILL_ON");for(let i=0;i<calls.length;i+=2)assert.equal(calls[i].user,calls[i+1].user);
});
