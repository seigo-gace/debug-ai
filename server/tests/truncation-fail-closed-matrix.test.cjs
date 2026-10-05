"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {truncationError}=require("../adapters/ai-core.js");
const {ROLES}=require("../roles.js");
const {assertComplete:codeScout}=require("../control/code-scout-skill-effect-benchmark.js");
const {assertComplete:causalScout}=require("../control/causal-scout-skill-effect-benchmark.js");
const {assertComplete:researcher}=require("../control/researcher-skill-effect-benchmark.js");
const {assertComplete:diagnoser}=require("../control/diagnoser-skill-effect-benchmark.js");
const {assertComplete:patchEngineer}=require("../control/patch-engineer-skill-effect-benchmark.js");
const {assertComplete:localReviewer}=require("../control/skill-effect-benchmark.js");
const {assertCompleteReply}=require("../control/model-ab-benchmark.js");

const envelope={choices:[{finish_reason:"length",message:{content:'{"partial":true}'}}],usage:{completion_tokens:128}};

function expectTruncated(fn){
  assert.throws(fn,error=>error?.code==="AI_CORE_OUTPUT_TRUNCATED"&&String(error?.message||error).includes("AI_CORE_OUTPUT_TRUNCATED"));
}

test("production truncation error is fail-closed",()=>{
  const error=truncationError("diagnoser",ROLES.diagnoser,{maxTokens:128,finishReason:"length",content:'{"partial":true}',envelope,telemetry:{}});
  assert.equal(error.code,"AI_CORE_OUTPUT_TRUNCATED");
  assert.equal(error.meta.finish_reason,"length");
});

test("all six real skill-effect clients reject finish_reason=length",()=>{
  for(const [role,assertComplete] of Object.entries({code_scout:codeScout,causal_scout:causalScout,researcher,diagnoser,patch_engineer:patchEngineer,local_reviewer:localReviewer})){
    assert.throws(()=>assertComplete(envelope,128),error=>error?.code==="AI_CORE_OUTPUT_TRUNCATED"&&error?.benchmark_metadata?.role===role&&error?.benchmark_metadata?.finish_reason==="length");
  }
});

test("Model A/B rejects visible partial output at finish_reason=length",()=>{
  expectTruncated(()=>assertCompleteReply("diagnoser",{max_tokens:128},{content:'{"partial":true}',finish_reason:"length",usage:{completion_tokens:128}}));
});
