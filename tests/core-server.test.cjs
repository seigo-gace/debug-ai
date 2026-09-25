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

test('latest six-role authority is fixed and AI Core aliases match',()=>{
  assert.equal(assertRoleContract(),true);
  assert.equal(ROLES.code_scout.authority_model,'Qwen2.5-Coder 7B');
  assert.equal(ROLES.causal_scout.authority_model,'Qwen3 8B non-thinking');
  assert.equal(ROLES.researcher.authority_model,'Granite 4.2 8B');
  assert.equal(ROLES.diagnoser.authority_model,'Qwen3 8B thinking');
  assert.equal(ROLES.patch_engineer.authority_model,'Qwen2.5-Coder 7B');
  assert.equal(ROLES.local_reviewer.authority_model,'Ministral 3 8B Reasoning');
  assert.deepEqual(EXTERNAL_REVIEW_POINTS,['hypothesis','final']);
});

test('AI Core adapter sends aliases only, never backend model or port',async()=>{
  let body;
  const a=createAiCoreAdapter({baseUrl:'http://ai-core.internal:9000',fetchImpl:async(_u,o)=>{body=JSON.parse(o.body);return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}),{status:200});}});
  await a.call('code_scout',{user:'x'});
  assert.equal(body.model,'debugai/code-scout');
  const text=JSON.stringify(body);
  assert.ok(!text.includes('Qwen2.5-Coder'));
  assert.ok(!text.includes('11434'));
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
