"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {MAX_TOKENS,CASES,buildSystemsForCase,scoreCase,runPatchEngineerSkillEffectBenchmark}=require("../control/patch-engineer-skill-effect-benchmark.js");

function good(c){return{patch_status:c.expected.patch_status,reproduction:{status:c.expected.reproduction.status,evidence_refs:[...c.expected.reproduction.evidence_refs],limitation:c.expected.reproduction.limitation},candidate_changes:[...c.expected.candidate_changes],diagnosis_evidence_refs:[...c.expected.diagnosis_evidence_refs],regression_risks:[...c.expected.regression_risks],rollback_boundary:c.expected.rollback_boundary,unrelated_changes:[...c.expected.unrelated_changes]};}

test("Patch Engineer benchmark fixes reproduction, minimal scope, blocked diagnosis, and rollback cases",()=>{
  assert.equal(MAX_TOKENS,600);assert.deepEqual(CASES.map(x=>x.id),["minimal_reproduced_candidate","explicit_reproduction_limitation","uncertain_diagnosis_blocks_patch","unrelated_refactor_avoidance"]);
  for(const c of CASES){const systems=buildSystemsForCase(c);assert.equal(systems.selected_skill_ids.length,3);assert.deepEqual(systems.selected_skill_ids,[...c.skills]);assert.match(systems.on,/SELECTED_SKILLS=/);assert.match(systems.on,/procedure=/);assert.doesNotMatch(systems.off,/SELECTED_SKILLS=|procedure=/);assert.match(systems.off,/ROLE=patch_engineer/);assert.match(systems.off,/Candidate plan only: never claim or perform patch application/i);}
});

test("Patch Engineer deterministic scorer enforces candidate-only minimal reversible output",()=>{
  for(const c of CASES)assert.equal(scoreCase(c,good(c)).score,5,c.id);
  const minimal=CASES[0];const scopeCreep=good(minimal);scopeCreep.candidate_changes.push("src/metrics.js:record:refactor");assert.ok(scoreCase(minimal,scopeCreep).score<5);
  const fabricated=good(minimal);fabricated.diagnosis_evidence_refs=["INVENTED_DIAGNOSIS"];assert.ok(scoreCase(minimal,fabricated).score<5);
  const blocked=CASES[2];const unsafe=good(blocked);unsafe.patch_status="CANDIDATE";unsafe.candidate_changes=["src/a.js:guess_fix"];unsafe.applied=true;assert.ok(scoreCase(blocked,unsafe).score<5);
});

test("Patch Engineer benchmark keeps paired inputs identical and derives the winner",async()=>{
  const calls=[];const outputs=new Map();for(const c of CASES){outputs.set(`off:${c.id}`,JSON.stringify({patch_status:"UNKNOWN",reproduction:{status:"LIMITATION",evidence_refs:[],limitation:"UNKNOWN"},candidate_changes:[],diagnosis_evidence_refs:[],regression_risks:[],rollback_boundary:null,unrelated_changes:[]}));outputs.set(`on:${c.id}`,JSON.stringify(good(c)));}
  const result=await runPatchEngineerSkillEffectBenchmark({callModel:async({mode,user})=>{const parsed=JSON.parse(user);calls.push({mode,user});return{content:outputs.get(`${mode}:${parsed.benchmark_case}`)};},clock:{now:(()=>{let n=0;return()=>++n;})()}});
  assert.equal(result.skill_selection_boundary,"MAX_3_PER_INVOCATION");assert.equal(result.score.skill_on,20);assert.ok(result.score.skill_off<20);assert.equal(result.score.winner,"SKILL_ON");for(let i=0;i<calls.length;i+=2)assert.equal(calls[i].user,calls[i+1].user);
});
