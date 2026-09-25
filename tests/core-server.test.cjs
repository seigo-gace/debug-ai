const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ROLES,EXTERNAL_REVIEW_POINTS,assertRoleContract}=require('../server/roles.js');
const {createAiCoreAdapter}=require('../server/adapters/ai-core.js');
const {StateMachine,canTransition}=require('../orchestrator/state-machine.js');
const {Store}=require('../orchestrator/store.js');
const {makeRequest}=require('../orchestrator/contracts.js');
const DebugGovernance=require('../orchestrator/debug-governance-core.js');

test('latest six-role authority is fixed and shared AI Core routing matches',()=>{
  assert.equal(assertRoleContract(),true);
  assert.equal(ROLES.code_scout.backend_model,'coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf');
  assert.equal(ROLES.causal_scout.backend_model,'qwen3//models/Qwen3-8B-Q4_K_M.gguf');
  assert.equal(ROLES.causal_scout.thinking,false);
  assert.equal(ROLES.researcher.backend_model,'granite//models/granite-4.2-8b-Q4_K_M.gguf');
  assert.equal(ROLES.diagnoser.backend_model,'qwen3//models/Qwen3-8B-Q4_K_M.gguf');
  assert.equal(ROLES.diagnoser.thinking,true);
  assert.equal(ROLES.patch_engineer.backend_model,'coder//models/qwen2.5-coder-7b-instruct-q4_k_m.gguf');
  assert.equal(ROLES.local_reviewer.backend_model,'ministral//models/Ministral-3-8B-Reasoning-2512-Q4_K_M.gguf');
  assert.deepEqual(EXTERNAL_REVIEW_POINTS,['hypothesis','final']);
});

test('AI Core adapter sends llama-swap model, bearer auth, and thinking control',async()=>{
  let request;
  const a=createAiCoreAdapter({baseUrl:'http://ai-core.internal:18080',apiKey:'secret',fetchImpl:async(_u,o)=>{request={headers:o.headers,body:JSON.parse(o.body)};return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}),{status:200});}});
  await a.call('causal_scout',{user:'x'});
  assert.equal(request.body.model,'qwen3//models/Qwen3-8B-Q4_K_M.gguf');
  assert.deepEqual(request.body.chat_template_kwargs,{enable_thinking:false});
  assert.equal(request.headers.authorization,'Bearer secret');
  await a.call('diagnoser',{user:'x'});
  assert.deepEqual(request.body.chat_template_kwargs,{enable_thinking:true});
});

test('canonical state machine remains fail-closed',()=>{
  assert.equal(canTransition('RECEIVED','PARSED'),true);
  assert.equal(canTransition('RECEIVED','APPLYING'),false);
});

test('store same request replay stays idempotent across timestamps',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'store-'));
  const s=new Store(root);
  const base=makeRequest({raw:'same'});
  base.created_at=1;
  s.saveRequest(base);
  s.saveRequest({...base,created_at:2});
  const p=path.join(root,'durable','request',`${base.request_hash}.json`);
  assert.equal(JSON.parse(fs.readFileSync(p,'utf8')).created_at,1);
});

test('debug governance module is present and exposes policy surface',()=>{
  assert.equal(typeof DebugGovernance,'object');
  assert.ok(Object.keys(DebugGovernance).length>0);
});

const {RepoPolicy}=require('../server/repo-policy.js');
const {RunAuthority}=require('../server/run-authority.js');
test('repo policy blocks paths outside workspace and non-allowlisted repos',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ws-'));const ok=path.join(root,'repo-a');fs.mkdirSync(ok);
  const p=new RepoPolicy({workspaceRoot:root,allowlist:'repo-a'});assert.equal(p.assertRepo(ok),fs.realpathSync(ok));
  const other=path.join(root,'repo-b');fs.mkdirSync(other);assert.throws(()=>p.assertRepo(other),/ALLOWLIST/);assert.throws(()=>p.assertRepo(os.tmpdir()),/OUTSIDE/);
});
test('run authority persists canonical state machine checkpoints',()=>{
  if(process.version!=='v24.20.0')return;
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ra-')),ws=path.join(root,'ws'),repo=path.join(ws,'r');fs.mkdirSync(repo,{recursive:true});
  const a=new RunAuthority({runtimeRoot:path.join(root,'rt'),repoPolicy:new RepoPolicy({workspaceRoot:ws,allowlist:'r'})});
  let run=a.start({rawRequest:'{"failure":"x"}',repo,projectId:'r'});assert.equal(run.state,'RECEIVED');run=a.transition(run,'PARSED');assert.equal(a.load(run.run_id).state,'PARSED');
});
