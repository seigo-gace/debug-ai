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

function reply(status,body){
  return new Response(status===200?JSON.stringify({choices:[{message:{content:body}}]}):"unavailable",{status});
}
test("Gemini-only configured review uses Gemini without trying missing Groq",async()=>{
  const calls=[];const adapter=createExternalReviewAdapter({groqKey:"",geminiKey:"free",fetchImpl:async(url)=>{calls.push(url);return reply(200,'{"verdict":"PASS"}');}});
  const result=await adapter.hypothesis(payload);
  assert.equal(result.json.verdict,"PASS");assert.equal(result.provider,"gemini");
  assert.equal(calls.length,1);assert.match(calls[0],/generativelanguage/);
});
test("Groq 429 or transport failure falls back once to available Gemini",async()=>{
  for(const failure of ["429","network"]){
    const calls=[];const adapter=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async(url)=>{
      calls.push(url);
      if(calls.length===1){if(failure==="429")return reply(429,"");throw Error("network");}
      return reply(200,'{"verdict":"PASS"}');
    }});
    const result=await adapter.hypothesis(payload);
    assert.equal(result.json.verdict,"PASS",failure);
    assert.equal(result.provider,"gemini",failure);
    assert.equal(calls.length,2,failure);
  }
});
test("one malformed Groq review response gets exactly one schema correction attempt",async()=>{
  const calls=[];const adapter=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async(url,opts)=>{
    calls.push({url,body:JSON.parse(opts.body)});
    return calls.length===1?reply(200,"not-json"):reply(200,'{"verdict":"PASS"}');
  }});
  const result=await adapter.final(payload);
  assert.equal(result.provider,"groq+gemini");assert.equal(result.json.verdict,"PASS");
  assert.equal(calls.length,3);assert.match(calls[1].body.messages[0].content,/verdict/);
  assert.match(calls[2].url,/generativelanguage/);
});
test("repeated malformed Groq output falls through to Gemini and never accepts malformed",async()=>{
  const calls=[];const adapter=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async(url)=>{
    calls.push(url);
    return calls.length<3?reply(200,"not-json"):reply(200,'{"verdict":"PASS"}');
  }});
  const out=await adapter.final(payload);
  assert.equal(out.provider,"gemini");assert.equal(out.json.verdict,"PASS");
  assert.equal(calls.length,3);
});
test("both free review providers unavailable fails closed, not PASS",async()=>{
  const calls=[];const adapter=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async(url)=>{calls.push(url);return reply(429,"");}});
  await assert.rejects(()=>adapter.hypothesis(payload),e=>e?.code==="EXTERNAL_FREE_PROVIDERS_UNAVAILABLE");
  assert.equal(calls.length,2);
});
test("Groq authentication failure is not hidden by Gemini fallback",async()=>{
  const calls=[];const adapter=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async(url)=>{calls.push(url);return reply(401,"");}});
  await assert.rejects(()=>adapter.final(payload),e=>e?.code==="GROQ_HTTP_401");
  assert.equal(calls.length,1);
});

test("free reviewer attempt budget includes invalid responses and rejects exhausted routes",async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async()=>{
    calls++;return reply(200,'{"confidence":"UNKNOWN"}');
  }});
  await assert.rejects(()=>a.final(payload),e=>e?.code==="EXTERNAL_FREE_PROVIDERS_UNAVAILABLE"&&e?.meta?.primary_code==="EXTERNAL_REVIEW_SCHEMA");
  assert.equal(calls,4);
});
test("no free review keys fails before any network dispatch",async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({groqKey:"",geminiKey:"",fetchImpl:async()=>{calls++;throw Error("DISPATCHED");}});
  await assert.rejects(()=>a.final(payload),e=>e?.code==="EXTERNAL_FREE_PROVIDERS_UNAVAILABLE");
  assert.equal(calls,0);
});
test("private review evidence is never sent to either provider",async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async()=>{calls++;throw Error("DISPATCHED");}});
  await assert.rejects(()=>a.hypothesis({privacy:{privacy_class:"PRIVATE",sanitized:false,opaque_evidence:false}}),/EXTERNAL_PRIVACY_METADATA_REQUIRED/);
  assert.equal(calls,0);
});

test("both configured free reviewers independently examine each of the two existing review stages",async()=>{
  for(const stage of ["hypothesis","final"]){
    const calls=[];
    const a=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async(url,opts)=>{
      calls.push({url,body:JSON.parse(opts.body)});
      return reply(200,'{"verdict":"PASS","reason":"evidence sufficient"}');
    }});
    const result=await a[stage](payload);
    assert.equal(calls.length,2,stage);
    assert.match(calls[0].url,/groq/);
    assert.match(calls[1].url,/generativelanguage/);
    assert.match(calls[0].body.messages[0].content,new RegExp(stage));
    assert.match(calls[1].body.messages[0].content,new RegExp(stage));
    for(const call of calls){assert.match(call.body.messages[0].content,/sanitized public evidence/);assert.match(call.body.messages[0].content,/Never return PASS merely/);assert.match(call.body.messages[0].content,/evidence_refs/);}
    assert.equal(result.provider,"groq+gemini");
    assert.equal(result.json.verdict,"PASS");
    assert.equal(result.primary.json.verdict,"PASS");
    assert.equal(result.second_opinion.json.verdict,"PASS");
  }
});
test("Gemini independently vetoes an unqualified Groq PASS in both existing review stages",async()=>{
  for(const stage of ["hypothesis","final"]){
    for(const verdict of ["FAIL","PENDING"]){
      let requests=0;
      const a=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async()=>{
        requests++;
        return reply(200,JSON.stringify({verdict:requests===1?"PASS":verdict,reason:"independent finding"}));
      }});
      const result=await a[stage](payload);
      assert.equal(requests,2);
      assert.equal(result.json.verdict,verdict,stage+":"+verdict);
    }
  }
});
test("Groq PENDING cannot become PASS by Gemini disagreement",async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async()=>{
    calls++;return reply(200,JSON.stringify({verdict:calls===1?"PENDING":"PASS",reason:"needs evidence"}));
  }});
  const result=await a.hypothesis(payload);
  assert.equal(calls,2);
  assert.equal(result.json.verdict,"PENDING");
});
test("failed second reviewer never silently approves first PASS",async()=>{
  let calls=0;
  const a=createExternalReviewAdapter({groqKey:"g",geminiKey:"m",fetchImpl:async()=>{
    calls++;if(calls===2)return reply(503,"");
    return reply(200,'{"verdict":"PASS","reason":"local evidence"}');
  }});
  const result=await a.final(payload);
  assert.equal(calls,2);
  assert.equal(result.json.verdict,"PENDING");
  assert.equal(result.second_opinion_error.code,"GEMINI_HTTP_503");
});
