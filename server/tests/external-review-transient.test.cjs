const test=require('node:test');
const assert=require('node:assert/strict');
const {createExternalReviewAdapter}=require('../adapters/external-review.js');

const payload={
  privacy:{privacy_class:'PUBLIC',sanitized:true,opaque_evidence:true},
  hypothesis:{statement:'opaque',cause_class:'UNKNOWN',evidence_count:0}
};

test('Gemini 503 preserves Groq non-PASS result without aborting analysis',async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({
    groqKey:'g',
    geminiKey:'m',
    fetchImpl:async()=>{
      calls++;
      if(calls===1)return new Response(JSON.stringify({choices:[{message:{content:'{"verdict":"FAIL","reason":"needs second opinion"}'}}]}),{status:200});
      return new Response('unavailable',{status:503});
    }
  });
  const out=await a.hypothesis(payload);
  assert.equal(out.json.verdict,'FAIL');
  assert.equal(out.provider,'groq');
  assert.equal(out.second_opinion,null);
  assert.deepEqual(out.second_opinion_error,{code:'GEMINI_HTTP_503',status:503,transient:true});
});

test('Gemini auth failure remains hard failure',async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({
    groqKey:'g',
    geminiKey:'m',
    fetchImpl:async()=>{
      calls++;
      if(calls===1)return new Response(JSON.stringify({choices:[{message:{content:'{"verdict":"FAIL"}'}}]}),{status:200});
      return new Response('unauthorized',{status:401});
    }
  });
  await assert.rejects(()=>a.hypothesis(payload),e=>e?.code==='GEMINI_HTTP_401');
});
