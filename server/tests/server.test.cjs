const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');

const {createAiCoreAdapter,ROLE_ALIASES}=require('../adapters/ai-core.js');
const {ROLES}=require('../roles.js');
const {RuntimeEvidenceStore}=require('../runtime-evidence.js');
const {evaluateAsset}=require('../asset-promotion.js');
const {createWorkflow}=require('../workflow.js');

test('fixed six AI roles route to the shared four-model AI Core',()=>{
  assert.deepEqual(Object.keys(ROLE_ALIASES),['code_scout','causal_scout','researcher','diagnoser','patch_engineer','local_reviewer']);
  assert.equal(ROLES.code_scout.backend_model,'coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf');
  assert.equal(ROLES.causal_scout.backend_model,'qwen3//models/Qwen3-8B-Q4_K_M.gguf');
  assert.equal(ROLES.researcher.backend_model,'granite//models/granite-4.2-8b-Q4_K_M.gguf');
  assert.equal(ROLES.local_reviewer.backend_model,'ministral//models/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf');
});

test('AI Core adapter uses llama-swap model, bearer auth, and Qwen3 thinking mode',async()=>{
  let got;
  const a=createAiCoreAdapter({baseUrl:'http://core.internal:18080',apiKey:'test-key',fetchImpl:async(u,o)=>{
    got={u,h:o.headers,b:JSON.parse(o.body)};
    return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}),{status:200});
  }});
  await a.call('diagnoser',{user:'x'});
  assert.equal(got.b.model,'qwen3//models/Qwen3-8B-Q4_K_M.gguf');
  assert.deepEqual(got.b.chat_template_kwargs,{enable_thinking:true});
  assert.equal(got.h.authorization,'Bearer test-key');
});

test('runtime evidence redacts and rotates',()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'de-'));
  const s=new RuntimeEvidenceStore(d,{retentionMs:1,maxBytes:999999});
  const x=s.write('r1','tool',{authorization:'Bearer abc',text:'token=secret'});
  const body=JSON.parse(fs.readFileSync(x.path,'utf8'));
  assert.equal(body.payload.authorization,'[REDACTED]');
  assert.equal(body.payload.text,'[REDACTED]');
  assert.equal(s.rotate(Date.now()+1000).files,0);
});

test('asset promotion rejects hypotheses and accepts confirmed reusable asset',()=>{
  assert.equal(evaluateAsset({kind:'hypothesis',confirmed:true,summary:'x'}).promote,false);
  assert.equal(evaluateAsset({kind:'confirmed_root_cause',confirmed:true,summary:'x'}).promote,true);
});

test('workflow runs scouts in parallel and blocks patch before external PASS',async()=>{
  let active=0,max=0;
  const ai={call:async(role)=>{
    active++;max=Math.max(max,active);
    await new Promise(r=>setTimeout(r,10));
    active--;
    return {content:JSON.stringify(role==='diagnoser'?{cause:'x'}:role==='researcher'?{evidence_ids:[]}:{authority:'HINT_ONLY'})};
  }};
  const w=createWorkflow({aiCore:ai});
  const a=await w.runAnalysis({failure:{message:'boom'}});
  assert.equal(max,2);
  assert.equal(a.state,'AWAITING_EXTERNAL_HYPOTHESIS_REVIEW');
  await assert.rejects(()=>w.patchCandidate({runId:a.run_id,checkedHypothesis:{},context:'',task:'x'}),/EXTERNAL_HYPOTHESIS/);
});

const {PatchService}=require('../patch-service.js');
test('patch service requires exact approval then applies and verifies real repo fixture',()=>{
  const repo=fs.mkdtempSync(path.join(os.tmpdir(),'repo-'));
  fs.writeFileSync(path.join(repo,'a.js'),'module.exports=1;\n');
  fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({scripts:{test:'node --test t.test.cjs'}}));
  fs.writeFileSync(path.join(repo,'t.test.cjs'),"const test=require('node:test'),assert=require('node:assert/strict');test('v',()=>assert.equal(require('./a.js'),2));\n");
  const rt=fs.mkdtempSync(path.join(os.tmpdir(),'rt-'));
  const p=new PatchService({runtimeRoot:rt});
  const c=p.create({repo,selectedPaths:['a.js'],task:'fix value',result:{summary:'fix',operations:[{type:'replace',path:'a.js',old:'module.exports=1;',new:'module.exports=2;'}]}});
  assert.throws(()=>p.apply({candidateId:c.id,candidateHash:c.candidate_hash,decision:'reject',repo}),/APPROVAL/);
  const out=p.apply({candidateId:c.id,candidateHash:c.candidate_hash,decision:'approve',repo});
  assert.equal(out.pass,true);
  assert.match(fs.readFileSync(path.join(repo,'a.js'),'utf8'),/2/);
});

const {TypeScript7LspClient}=require('../adapters/typescript-lsp.js');
test('TypeScript 7 LSP client uses JSON-RPC Content-Length framing',async()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'ts7-')),file=path.join(d,'a.ts'),fake=path.join(d,'fake.cjs');
  fs.writeFileSync(file,'export function foo(x:number){return x+1}\nexport const y=foo(2)\n');
  const src=String.raw`let b=Buffer.alloc(0);const send=(id,result)=>{const body=Buffer.from(JSON.stringify({jsonrpc:'2.0',id,result}));process.stdout.write('Content-Length: '+body.length+'\r\n\r\n');process.stdout.write(body)};process.stdin.on('data',c=>{b=Buffer.concat([b,c]);for(;;){const h=b.indexOf('\r\n\r\n');if(h<0)return;const m=/Content-Length:\s*(\d+)/i.exec(b.slice(0,h).toString());if(!m)return;const n=Number(m[1]);if(b.length<h+4+n)return;const q=JSON.parse(b.slice(h+4,h+4+n));b=b.slice(h+4+n);if(!('id' in q))continue;if(q.method==='initialize')send(q.id,{capabilities:{}});else if(q.method==='textDocument/documentSymbol')send(q.id,[{name:'foo',kind:12,range:{start:{line:0,character:0},end:{line:0,character:36}},selectionRange:{start:{line:0,character:16},end:{line:0,character:19}}}]);else if(q.method==='textDocument/definition')send(q.id,{uri:q.params.textDocument.uri,range:{start:{line:0,character:16},end:{line:0,character:19}}});else if(q.method==='textDocument/references')send(q.id,[{uri:q.params.textDocument.uri,range:{start:{line:0,character:16},end:{line:0,character:19}}},{uri:q.params.textDocument.uri,range:{start:{line:1,character:15},end:{line:1,character:18}}}]);else if(q.method==='shutdown')send(q.id,null);}});`;
  fs.writeFileSync(fake,src);
  const c=new TypeScript7LspClient({rootDir:d,command:process.execPath,args:[fake],timeoutMs:3000});
  try{
    await c.start();c.open(file);
    const syms=await c.documentSymbols(file);
    assert.equal(syms[0].name,'foo');
    assert.equal((await c.definition(file,'foo')).length,1);
    assert.equal((await c.references(file,'foo')).length,2);
  }finally{await c.stop();}
});

const {sourceGate,composeGate}=require('../gates.js');
const {createOsvAdapter}=require('../adapters/osv.js');
test('production source gate has no direct Ollama or direct Telegram backends',()=>{
  const g=sourceGate(path.join(__dirname,'..','..'));
  assert.deepEqual(g,{pass:true,failures:[]});
});
test('compose security/ownership gate passes',()=>{
  assert.equal(composeGate(path.join(__dirname,'..','..','compose.yaml')).pass,true);
});
test('OSV adapter enforces offline DB and parses scanner result',()=>{
  const fake=()=>({status:0,stdout:'{"results":[]}',stderr:''});
  const a=createOsvAdapter({dbPath:'/db',spawnSync:fake});
  assert.equal(a.scan('/repo').vulnerable,false);
  assert.throws(()=>createOsvAdapter({spawnSync:fake}).scan('/repo'),/OSV_DB_REQUIRED/);
});

const {createEvidenceSearchAdapter,stableStringify}=require('../adapters/evidence-search.js');
test('Evidence Search adapter signs and maps existing Astera main internal API contract',async()=>{
  let got;
  const credential='0123456789abcdef0123456789abcdef';
  const a=createEvidenceSearchAdapter({
    baseUrl:'http://127.0.0.1:7376',
    internalCredential:credential,
    callerId:'debug-ai',
    fetchImpl:async(u,o)=>{
      got={u,h:o.headers,b:JSON.parse(o.body),raw:o.body};
      return new Response(JSON.stringify({
        schema_version:'astera.evidence-search.result.v1',
        request_id:got.b.request_id,
        caller_id:'debug-ai',
        status:'FINAL_VALID',
        evidence:[{
          candidate_id:'evc_1',provider_id:'official-docs',source_role:'OFFICIAL',title:'Spec',excerpt:'x',
          canonical_locator:{url:'https://example.test/spec'},content_hash:'a'.repeat(64),published_at:null,updated_at:null
        }],
        ai_used:false,payment_executed:false
      }),{status:200});
    }
  });
  const out=await a.search({query:'node fs',topics:['runtime'],limit:4});
  assert.equal(got.u,'http://127.0.0.1:7376/internal/v1/evidence/search');
  assert.equal(got.b.question,'node fs');
  assert.equal(got.b.maximum_results,4);
  assert.equal(got.b.paid_search.enabled,false);
  assert.equal(got.h['x-astera-service'],'astera-main');
  assert.equal(got.h['x-astera-caller-id'],'debug-ai');
  assert.equal(got.h['x-astera-body-sha256'],crypto.createHash('sha256').update(got.raw).digest('hex'));
  const fields={service:got.h['x-astera-service'],caller_id:got.h['x-astera-caller-id'],request_id:got.h['x-astera-request-id'],issued_at:got.h['x-astera-issued-at'],expires_at:got.h['x-astera-expires-at'],nonce:got.h['x-astera-nonce'],body_sha256:got.h['x-astera-body-sha256']};
  const expected=crypto.createHmac('sha256',credential).update(stableStringify(fields)).digest('hex');
  assert.equal(got.h['x-astera-signature'],expected);
  assert.equal(out.length,1);
  assert.equal(out[0].source_ref,'evc_1');
  assert.equal(out[0].authority,'OFFICIAL');
});

test('Evidence Search adapter fails closed on non-final evidence',async()=>{
  const a=createEvidenceSearchAdapter({
    baseUrl:'http://127.0.0.1:7376',
    internalCredential:'0123456789abcdef0123456789abcdef',
    fetchImpl:async()=>new Response(JSON.stringify({schema_version:'astera.evidence-search.result.v1',status:'REJECTED',evidence:[],ai_used:false,payment_executed:false}),{status:200})
  });
  await assert.rejects(()=>a.search({query:'x'}),/Evidence Search status REJECTED/);
});

const {createTgserverAdapter}=require('../adapters/tgserver.js');
test('TGserver adapter uses existing ingest/search APIs, separates P004/P005, and redacts secrets',async()=>{
  const calls=[];
  const a=createTgserverAdapter({baseUrl:'http://tg.internal:3000',logProjectId:'P004',kbProjectId:'P005',fetchImpl:async(u,o)=>{
    const b=JSON.parse(o.body);calls.push({u,b});
    if(u.endsWith('/search'))return new Response(JSON.stringify({hits:[{project_id:'P005',message:'known fix'}]}),{status:200});
    if(u.endsWith('/ingest/bulk'))return new Response(JSON.stringify({results:b.logs.map(()=>({status:'accepted'}))}),{status:200});
    return new Response(JSON.stringify({status:'accepted',hash:'h1'}),{status:200});
  }});
  const queued=await a.log({kind:'gate',severity:'warn',authorization:'Bearer abc',summary:'runtime'});
  assert.equal(queued.status,'queued');
  await a.promote({kind:'accepted_fix',confirmed:true,summary:'fixed',nested:{api_key:'xyz'},supersedes:'old'});
  assert.equal(await a.flushLogs(500),true);
  const hits=await a.search('known fix');
  const bulk=calls.find(x=>x.u.endsWith('/ingest/bulk'));
  const promote=calls.find(x=>x.u.endsWith('/ingest'));
  const search=calls.find(x=>x.u.endsWith('/search'));
  assert.ok(bulk);
  assert.equal(bulk.b.logs.length,1);
  assert.equal(bulk.b.logs[0].project_id,'P004');
  assert.equal(bulk.b.logs[0].severity,'warn');
  assert.ok(promote);
  assert.equal(promote.b.project_id,'P005');
  assert.ok(search);
  assert.equal(search.b.project_id,'P005');
  assert.equal(hits.length,1);
  const wire=JSON.stringify(calls);
  assert.ok(!wire.includes('abc'));
  assert.ok(!wire.includes('xyz'));
  assert.match(promote.b.message,/"event_type":"knowledge"/);
});

const {assertPublicOpaque,createExternalReviewAdapter}=require('../adapters/external-review.js');
test('external review is restricted to sanitized PUBLIC opaque payload',async()=>{
  assert.throws(()=>assertPublicOpaque({privacy:{privacy_class:'PRIVATE',sanitized:true,opaque_evidence:true}}),/PRIVACY/);
  assert.throws(()=>assertPublicOpaque({privacy:{privacy_class:'PUBLIC',sanitized:true,opaque_evidence:true},detail:'/home/example/secret'}),/PRIVACY_BLOCK/);
  let got;
  const a=createExternalReviewAdapter({groqKey:'k',geminiKey:null,fetchImpl:async(u,o)=>{
    got=JSON.parse(o.body);
    return new Response(JSON.stringify({choices:[{message:{content:'{"verdict":"PASS"}'}}]}),{status:200});
  }});
  const r=await a.hypothesis({privacy:{privacy_class:'PUBLIC',sanitized:true,opaque_evidence:true},claim:'opaque'});
  assert.equal(r.json.verdict,'PASS');
  assert.equal(got.model,'openai/gpt-oss-20b');
});

const {DapClient}=require('../adapters/dap.js');
test('DAP client speaks real Content-Length request/response framing',async()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'dap-'));
  const fake=path.join(d,'fake.cjs');
  fs.writeFileSync(fake,`let b=Buffer.alloc(0);process.stdin.on('data',c=>{b=Buffer.concat([b,c]);for(;;){let h=b.indexOf('\\r\\n\\r\\n');if(h<0)return;let m=/Content-Length:\\s*(\\d+)/i.exec(b.slice(0,h).toString());if(!m)return;let n=Number(m[1]);if(b.length<h+4+n)return;let q=JSON.parse(b.slice(h+4,h+4+n));b=b.slice(h+4+n);let body=Buffer.from(JSON.stringify({seq:1,type:'response',request_seq:q.seq,success:true,command:q.command,body:{echo:q.arguments}}));process.stdout.write('Content-Length: '+body.length+'\\r\\n\\r\\n');process.stdout.write(body)}});`);
  const c=new DapClient({command:process.execPath,args:[fake],timeoutMs:3000});
  try{
    await c.start();
    const out=await c.request('stackTrace',{threadId:1});
    assert.deepEqual(out,{echo:{threadId:1}});
  }finally{await c.stop();}
});

const {createServer}=require('../http.js');
test('HTTP analysis rejects malformed production role output before downstream diagnosis',async()=>{
  const {createWorkflow:observedWorkflow}=require('../workflow-observed.js');
  const calls=[];
  const workflow=observedWorkflow({aiCore:{call:async role=>{
    calls.push(role);
    if(role==='code_scout')return{content:JSON.stringify({relevant_files:42})};
    if(role==='causal_scout')return{content:JSON.stringify({candidates:[]})};
    throw new Error(`UNEXPECTED_DOWNSTREAM_ROLE:${role}`);
  }}});
  const server=createServer({workflow});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/analyze`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({failure:{message:'fixture failure'}})});
    assert.equal(response.status,400);
    const result=await response.json();assert.match(result.error,/ROLE_SEMANTIC_INVALID:code_scout/);
    assert.equal(Object.hasOwn(result,'diagnosis'),false);
    assert.equal(calls.includes('researcher'),false);assert.equal(calls.includes('diagnoser'),false);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('HTTP API exposes health and delegates analyze without public backend leakage',async()=>{
  const workflow={runAnalysis:async b=>({state:'OK',got:b}),patchCandidate:async()=>({}),approveAndVerify:async()=>({}),promote:async()=>({})};
  const s=createServer({workflow});
  await new Promise(r=>s.listen(0,'127.0.0.1',r));
  try{
    const port=s.address().port;
    let r=await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(r.status,200);
    const h=await r.json();
    assert.equal(h.patch_apply_requires_explicit_approval,true);assert.equal(h.patch_apply_approval_authority,"controlling_parent_orchestrator");assert.equal(h.patch_apply_requires_master_approval,false);
    r=await fetch(`http://127.0.0.1:${port}/v1/analyze`,{method:'POST',headers:{'content-type':'application/json'},body:'{"failure":{"message":"x"}}'});
    assert.equal(r.status,200);
    const b=await r.json();
    assert.equal(b.state,'OK');
  }finally{await new Promise(r=>s.close(r));}
});
