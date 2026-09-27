const test=require('node:test');
const assert=require('node:assert/strict');
const {createWorkflow}=require('../workflow.js');

test('workflow reuses TGserver KB, runtime-registers it for roles, and emits runtime events',async()=>{
  const calls=[];
  const tgserver={
    search:async q=>{calls.push(['search',q]);return [{project_id:'P004',message:'known root cause'}];},
    log:async event=>{calls.push(['log',event.kind,event.severity]);return {status:'accepted'};},
    promote:async()=>({status:'accepted'}),
  };
  const ai={
    call:async(role,req)=>{
      calls.push(['ai',role,req.user]);
      if(role==='researcher')return {content:JSON.stringify({evidence_ids:['kb-1']})};
      if(role==='diagnoser')return {content:JSON.stringify({public_statement:'known mismatch',cause_kind:'CONFIG'})};
      return {content:JSON.stringify({role})};
    },
  };
  const evidenceSearch={search:async()=>[{title:'Official',url:'https://example.test',authority:'official'}]};
  const externalReview={hypothesis:async()=>({json:{verdict:'PASS'}})};
  const w=createWorkflow({aiCore:ai,tgserver,evidenceSearch,externalReview});
  const out=await w.runAnalysis({failure:{message:'boom'}});
  assert.equal(out.state,'HYPOTHESIS_APPROVED');
  assert.equal(out.known_knowledge.length,1);
  assert.equal(out.known_knowledge[0].message,'known root cause');
  const researcher=JSON.parse(calls.find(x=>x[0]==='ai'&&x[1]==='researcher')[2]);
  assert.match(researcher.knownKnowledge[0].evidence_id,/^EVI_[a-f0-9]{24}$/);
  assert.equal(researcher.knownKnowledge[0].source_type,'INTERNAL_KB');
  assert.equal(researcher.knownKnowledge[0].payload.message,'known root cause');
  assert.match(researcher.official[0].evidence_id,/^EVI_[a-f0-9]{24}$/);
  assert.equal(researcher.official[0].source_type,'OFFICIAL_EXTERNAL');
  assert.ok(calls.some(x=>x[0]==='log'&&x[1]==='failure'&&x[2]==='error'));
  assert.ok(calls.some(x=>x[0]==='log'&&x[1]==='analysis'&&x[2]==='info'));
});
