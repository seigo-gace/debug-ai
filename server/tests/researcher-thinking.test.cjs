const test=require('node:test');
const assert=require('node:assert/strict');

const {ROLES}=require('../roles.js');
const {createAiCoreAdapter}=require('../adapters/ai-core.js');

test('researcher role is explicitly non-thinking while diagnoser remains thinking',()=>{
  assert.equal(ROLES.researcher.thinking,false);
  assert.equal(ROLES.researcher.authority_model,'Granite 4.2 8B non-thinking');
  assert.equal(ROLES.diagnoser.thinking,true);
});

test('AI Core adapter sends enable_thinking=false for researcher',async()=>{
  let got;
  const adapter=createAiCoreAdapter({
    baseUrl:'http://core.internal:18080',
    apiKey:'test-key',
    fetchImpl:async(_url,options)=>{
      got=JSON.parse(options.body);
      return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]}),{status:200});
    }
  });

  const out=await adapter.call('researcher',{
    system:'Researcher. JSON only.',
    user:'{"probe":"runtime"}',
    maxTokens:512
  });

  assert.equal(out.role,'researcher');
  assert.deepEqual(got.chat_template_kwargs,{enable_thinking:false});
  assert.equal(got.max_tokens,512);
});
