"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {compileInvocation,normalizeTaskSpecificPolicy,COMMON_PROMPT_PREFIX,WORK_ITEM_ENVELOPE}=require("../control/invocation-compiler.js");
test("old hard brevity instructions become nonbinding targets and never override schema or material evidence",()=>{
 const result=normalizeTaskSpecificPolicy("Return one compact JSON object under 400 tokens. Use at most 3 items per array.");
 assert.match(result,/OUTPUT_SOFT_TARGETS=output tokens target 400; items per array target 3/);
 assert.match(result,/exceed them rather than truncate or omit required evidence/);
 assert.match(result,/OUTPUT_COMPLETENESS_OVERRIDE=/);
 assert.doesNotMatch(result,/under 400 tokens|at most 3 items per array/i);
 assert.doesNotMatch(normalizeTaskSpecificPolicy("Return every material detail."),/OUTPUT_SOFT_TARGETS/);
});
test("shared invariant policy has identical leading bytes for every role, with variable task after",()=>{
 const common=COMMON_PROMPT_PREFIX.join("\n")+"\n";
 const roles=["code_scout","causal_scout","researcher","diagnoser","patch_engineer","local_reviewer"];
 for(const role of roles){
  for(const task of ["source contract version","failure runtime trace regression"]){
   const x=compileInvocation(role,{task,extraSystem:"Different task detail",outputEnvelope:WORK_ITEM_ENVELOPE});
   assert.ok(x.system.startsWith(common));assert.ok(x.system.includes("ROLE="+role));
   assert.ok(x.system.includes("TOP_LEVEL_PROTOCOL="));
   assert.ok(x.system.includes("TASK_SPECIFIC_POLICY=Different task detail"));
   assert.match(x.system,/model output is not evidence/);
  }
 }
});
