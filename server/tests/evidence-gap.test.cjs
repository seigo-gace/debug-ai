const test=require('node:test');
const assert=require('node:assert/strict');
const {createWorkflow}=require('../workflow.js');

function fakeAi(){
  return {
    call:async(role)=>({
      content:JSON.stringify(
        role==='diagnoser'
          ? {public_statement:'missing file handling mismatch',cause_kind:'FILESYSTEM'}
          : role==='researcher'
            ? {evidence_ids:[],conclusion:'continue with explicit evidence gap'}
            : {authority:'HINT_ONLY'}
      )
    })
  };
}

test('analysis continues with explicit evidence gap when Astera evidence is non-final',async()=>{
  const err=Object.assign(new Error('Evidence Search status REJECTED_INITIAL_QUALITY'),{
    code:'EVIDENCE_SEARCH_NOT_FINAL',
    meta:{status:'REJECTED_INITIAL_QUALITY'}
  });
  const evidenceSearch={search:async()=>{throw err;}};
  const w=createWorkflow({aiCore:fakeAi(),evidenceSearch});
  const out=await w.runAnalysis({failure:{message:'ENOENT missing config'}});
  assert.equal(out.evidence_gap,true);
  assert.equal(out.evidence_status,'REJECTED_INITIAL_QUALITY');
  assert.deepEqual(out.official_evidence,[]);
  assert.equal(out.scouts.length,2);
  assert.ok(out.research);
  assert.ok(out.diagnosis);
});

test('analysis still hard-fails on Evidence Search auth/schema/runtime errors',async()=>{
  const err=Object.assign(new Error('Evidence Search HTTP 401'),{code:'EVIDENCE_SEARCH_HTTP'});
  const evidenceSearch={search:async()=>{throw err;}};
  const w=createWorkflow({aiCore:fakeAi(),evidenceSearch});
  await assert.rejects(
    ()=>w.runAnalysis({failure:{message:'ENOENT missing config'}}),
    /Evidence Search HTTP 401/
  );
});
