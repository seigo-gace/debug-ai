const test=require('node:test');
const assert=require('node:assert/strict');
const {createWorkflow}=require('../workflow.js');

function fakeAi(calls=[]){
  return {
    call:async(role,payload)=>{
      calls.push({role,payload});
      return {
        content:JSON.stringify(
          role==='diagnoser'
            ? {diagnoses:[{id:'D001',hypothesis:'Dockerfile omits scripts directory',testable:true,status:'supported'}],evidence_gap:true}
            : role==='researcher'
              ? {evidence_ids:['L001'],conclusion:'local source evidence supports the mismatch'}
              : {authority:'HINT_ONLY'}
        )
      };
    }
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

test('local evidence is runtime-registered for Diagnoser while external hypothesis review preserves sanitized public shape',async()=>{
  const err=Object.assign(new Error('Evidence Search status REJECTED_INITIAL_QUALITY'),{
    code:'EVIDENCE_SEARCH_NOT_FINAL',
    meta:{status:'REJECTED_INITIAL_QUALITY'}
  });
  const calls=[];
  let externalPayload;
  const evidenceSearch={search:async()=>{throw err;}};
  const externalReview={hypothesis:async payload=>{externalPayload=payload;return {provider:'test',json:{verdict:'PASS'}};}};
  const localEvidence=[{id:'L001',kind:'source',observation:'Dockerfile copies src but does not copy scripts.'}];
  const w=createWorkflow({aiCore:fakeAi(calls),evidenceSearch,externalReview});
  const out=await w.runAnalysis({failure:{message:'topics:provision unavailable'},localEvidence});
  const diagnoserCall=calls.find(x=>x.role==='diagnoser');
  const diagnoserInput=JSON.parse(diagnoserCall.payload.user);
  assert.equal(diagnoserInput.localEvidence.length,1);
  assert.match(diagnoserInput.localEvidence[0].evidence_id,/^EVI_[a-f0-9]{24}$/);
  assert.equal(diagnoserInput.localEvidence[0].source_type,'LOCAL_RUNTIME');
  assert.equal(diagnoserInput.localEvidence[0].source_ref,'L001');
  assert.deepEqual(diagnoserInput.localEvidence[0].payload,localEvidence[0]);
  assert.equal(diagnoserInput.evidence_gap_scope,'official_evidence_search');
  assert.equal(externalPayload.hypothesis.statement,'Dockerfile omits scripts directory');
  assert.equal(externalPayload.hypothesis.local_evidence_count,1);
  assert.deepEqual(externalPayload.hypothesis.local_evidence,[{id:'L001',kind:'source',observation:'Dockerfile copies src but does not copy scripts.'}]);
  assert.equal(externalPayload.hypothesis.evidence_gap,true);
  assert.equal(externalPayload.hypothesis.evidence_gap_scope,'official_evidence_search');
  assert.equal(out.state,'HYPOTHESIS_APPROVED');
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
