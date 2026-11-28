const test=require("node:test"),assert=require("node:assert/strict");
const {compileInvocation}=require("../control/invocation-compiler.js");
test("isolated candidate reviewer does not receive pre-candidate-only contract",()=>{
 const p=compileInvocation("local_reviewer",{extraSystem:"REVIEW_PHASE=ISOLATED_CANDIDATE\nReview the verified candidate."}).system;
 assert.match(p,/REVIEW_SCOPE=ISOLATED_CANDIDATE/);assert.doesNotMatch(p,/REVIEW_SCOPE=HYPOTHESIS_ONLY/);
 assert.match(p,/not application or completed repair/);assert.match(p,/actual executed checks/);
});
test("fixed output protocol precedes dynamic skills and task policy",()=>{
 const a=compileInvocation("diagnoser",{task:"source error",extraSystem:"task A"}).system;
 const b=compileInvocation("diagnoser",{task:"evidence gap",extraSystem:"task B"}).system;
 const prefix=s=>s.split("SKILL_SELECTION=")[0];
 assert.equal(prefix(a),prefix(b));assert.match(prefix(a),/OUTPUT_FIELDS=/);
});