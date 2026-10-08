'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {fixture}=require('./fixtures/gitops-delegation-fixture.cjs');
function master(t){
 const f=fixture(t),compose=path.join(f.repo,'compose.yaml');fs.writeFileSync(compose,'verified compose');
 Object.assign(f.policy,{schema:'debugai.master-internal-delegation/v1',delegation_mode:'MASTER_INTERNAL_PERSISTENT',repository:'seigo-gace/debug-ai',repository_id:123,repository_node_id:'R_test',repository_owner:'seigo-gace',master_principal:'seigo-gace',server_project_id:'repo',server_project_path:f.repo,default_branch:'main',allowed_branches:[f.policy.branch],enabled:true,project:{owner:'seigo-gace',number:1,node_id:'PVT_kwHODOQFoM4BEJII',item_id:'item_test',control_url:'https://github.com/seigo-gace/debug-ai/issues/41'},runtime_target:{id:'debugai.compose',compose_file:'compose.yaml',compose_digest:crypto.createHash('sha256').update(fs.readFileSync(compose)).digest('hex'),services:['debug-ai','sandbox-runner'],health_service:'debug-ai',health_url:'http://127.0.0.1:8787/health'}});
 delete f.policy.expires_at;delete f.policy.valid_from;delete f.policy.branch;
 Object.assign(f.request.delegation,{mode:'MASTER_INTERNAL_PERSISTENT',repository:f.policy.repository,runtime_target:f.policy.runtime_target.id});
 const registry={schema:'gace.workspace-master-internal-registry/v1',project:{owner:'seigo-gace',number:1,node_id:'PVT_kwHODOQFoM4BEJII'},master_principal:'seigo-gace',master_owners:['seigo-gace'],repositories:[f.policy]};
 const registryFile=path.join(f.root,'registry.json'),githubFile=path.join(f.root,'github.json');
 const github={login:'seigo-gace',metadata:{full_name:f.policy.repository,id:123,node_id:'R_test',owner:{login:'seigo-gace'},default_branch:'main',permissions:{admin:true}},project:{id:'PVT_kwHODOQFoM4BEJII',owner:{login:'seigo-gace'},number:1,closed:false},items:{items:[{id:'item_test',content:{repository:f.policy.repository,url:f.policy.project.control_url}}]}};
 const gh=path.join(f.root,'gh');fs.writeFileSync(gh,`#!/bin/sh\ncase "$1 $2" in\n'api user') jq -r .login '${githubFile}';;\n'api repos/seigo-gace/debug-ai') jq .metadata '${githubFile}';;\n'project view') jq .project '${githubFile}';;\n'project item-list') jq .items '${githubFile}';;\n*) exit 90;;\nesac\n`,{mode:0o700});
 const docker=path.join(f.root,'docker');fs.writeFileSync(docker,`#!/bin/sh\nif [ "$2" = config ]; then printf 'debug-ai\\nsandbox-runner\\n'; exit 0; fi\necho "$2" >> '${f.calls}'\nif [ "$1" = inspect ]; then echo 'running|healthy'; elif [ "$2" = ps ]; then echo test-container; fi\n`,{mode:0o700});
 Object.assign(f.env,{DEBUG_AI_GITOPS_GH_BIN:gh,DEBUG_AI_MASTER_REGISTRY:registryFile,DEBUG_AI_MASTER_PROJECT_ROOT:f.root});
 const sync=()=>{f.write(f.policyFile,f.policy);f.write(registryFile,registry);f.write(githubFile,github);};sync();
 return Object.assign(f,{registry,registryFile,github,githubFile,sync});
}
for(const [label,change,error] of [
 ['unregistered Project repo',f=>f.github.items.items=[],'MASTER_PROJECT_REPOSITORY_UNREGISTERED'],
 ['outside Master owners',f=>f.policy.repository_owner='customer','MASTER_OWNER_FORBIDDEN'],
 ['unknown registry entry',f=>f.registry.repositories=[],'MASTER_REGISTRY_READBACK_MISMATCH'],
 ['disabled entry',f=>f.policy.enabled=false,'MASTER_DELEGATION_DISABLED_OR_REVOKED'],
 ['revoked entry',f=>f.policy.revoked=true,'MASTER_DELEGATION_DISABLED_OR_REVOKED'],
 ['missing server mapping',f=>f.policy.server_project_path+='/unknown','MASTER_MAPPING_INVALID'],
 ['mismatched actual runtime mapping',f=>f.policy.runtime_target.compose_digest='0'.repeat(64),'MASTER_RUNTIME_MAPPING_MISMATCH'],
 ['owner changed in GitHub',f=>f.github.metadata.owner.login='customer','MASTER_REPOSITORY_OWNER_MISMATCH'],
 ['repository recreated under same name',f=>f.github.metadata.id=999,'MASTER_REPOSITORY_OWNER_MISMATCH'],
 ['no Master admin right',f=>f.github.metadata.permissions.admin=false,'MASTER_REPOSITORY_OWNER_MISMATCH'],
 ['wrong authenticated Host principal',f=>f.github.login='customer','MASTER_PRINCIPAL_MISMATCH'],
 ['Project identity drift',f=>f.github.project.id='another','MASTER_PROJECT_MISMATCH'],
 ['out-of-scope branch',f=>f.request.branch='main','MASTER_BRANCH_FORBIDDEN'],
 ['SHA mismatch',f=>f.request.sha='f'.repeat(40),'DELEGATION_SHA_MISMATCH'],
 ['operation forbidden',f=>f.policy.allowed_operations=['publish'],'MASTER_OPERATION_POLICY_INVALID'],
 ['scope forbidden',f=>f.request.delegation.scope='other.scope','MASTER_SCOPE_FORBIDDEN'],
 ['runtime target forbidden',f=>f.request.delegation.runtime_target='customer.compose','MASTER_RUNTIME_TARGET_FORBIDDEN'],
 ['protected effect',f=>f.request.delegation.effects.secrets=true,'MASTER_PROTECTED_EFFECT_FORBIDDEN'],
 ['protected Compose source change',f=>fs.writeFileSync(path.join(f.root,'forbidden-path'),'1'),'MASTER_PROTECTED_PATH_FORBIDDEN'],
 ['persistent policy has expiry',f=>f.policy.expires_at=Date.now()+600000,'MASTER_REGISTRY_ENTRY_INVALID'],
 ['expired request',f=>f.request.expires_at=1,'DELEGATION_REQUEST_EXPIRED'],
 ['operation ID mismatch',f=>f.request.delegation.operation_id='other','DELEGATION_OPERATION_ID_MISMATCH'],
 ['principal mismatch',f=>f.request.delegation.request_identity='customer','DELEGATION_REQUEST_IDENTITY_MISMATCH'],
])test(`Master Internal actual Bash/jq fails closed: ${label}`,t=>{const f=master(t);change(f);f.sync();const s=f.run();assert.equal(s.state,'FAIL',JSON.stringify(s));assert.equal(s.error,error);assert.equal(fs.existsSync(f.calls),false);assert.equal(fs.existsSync(f.receipt),false);});
test('persistent grant needs no expiry/legacy policy and retains short bound receipt with replay rejection',t=>{const f=master(t);const s=f.run();assert.equal(s.state,'PASS',s.error);assert.equal(s.authorization.delegation_mode,'MASTER_INTERNAL_PERSISTENT');assert.equal(s.authorization.repository,f.policy.repository);assert.deepEqual(s.authorization.project,f.policy.project);assert.equal(s.authorization.server_project_path,f.repo);assert.ok(s.authorization.expires_at-s.authorization.issued_at<=300000);assert.ok(s.authorization.receipt_consumed_at);assert.ok(fs.existsSync(f.receipt+'.used'));const calls=fs.readFileSync(f.calls,'utf8');assert.deepEqual(f.run(),s);assert.equal(fs.readFileSync(f.calls,'utf8'),calls);assert.match(fs.readFileSync(path.join(f.queue,`status/${f.id}.rejections.jsonl`),'utf8'),/REPLAY_REJECTED/);});
test('fresh Project removal during build stops production recreate',t=>{const f=master(t),docker=path.join(f.root,'docker');fs.appendFileSync(docker,`if [ "$2" = build ]; then jq '.items.items=[]' '${f.githubFile}' > '${f.root}/new'; cat '${f.root}/new' > '${f.githubFile}'; fi\n`);const s=f.run();assert.equal(s.state,'FAIL');assert.equal(s.error,'MASTER_PROJECT_REPOSITORY_UNREGISTERED');assert.ok(s.authorization.receipt_consumed_at);assert.doesNotMatch(fs.readFileSync(f.calls,'utf8'),/\bup\b/);});
test('registry changed after receipt issuance cannot consume receipt',t=>{const f=master(t),r=f.receiptCheck(`jq '.audit_identity="changed"' '${f.policyFile}' > '${f.root}/p'; cat '${f.root}/p' > '${f.policyFile}'`);assert.equal(r.status,1);assert.match(r.stdout,/MASTER_REGISTRY_READBACK_MISMATCH/);});
for(const [label,mutation,error] of [
 ['expired receipt',f=>`jq '.expires_at=1' '${f.receipt}' > '${f.root}/r'; cat '${f.root}/r' > '${f.receipt}'`,'DELEGATION_RECEIPT_EXPIRED'],
 ['stale checkout',f=>`echo '${'c'.repeat(40)}' > '${f.root}/changed-head'`,'DELEGATION_TARGET_STATE_CHANGED'],
 ['revoked after issuance',f=>`jq '.revoked=true' '${f.policyFile}' > '${f.root}/p'; cat '${f.root}/p' > '${f.policyFile}'`,'MASTER_DELEGATION_DISABLED_OR_REVOKED'],
 ['receipt metadata tamper',f=>`jq '.runtime_target="other"' '${f.receipt}' > '${f.root}/r'; cat '${f.root}/r' > '${f.receipt}'`,'DELEGATION_RECEIPT_BINDING_MISMATCH'],
 ['single-use replay',f=>'true','DELEGATION_RECEIPT_REUSED'],
])test(`persistent operation receipt rejects ${label}`,t=>{const f=master(t),r=f.receiptCheck(mutation(f));assert.equal(r.status,1);assert.match(r.stdout,new RegExp(error),r.stderr);});
test('Host admission adds exact registry entry with readback/audit, then disables and revokes without legacy changes',t=>{
 const f=master(t),script=path.resolve(__dirname,'../../scripts/host-gitops-register-master.sh'),env={...f.env,PATH:f.root+':'+process.env.PATH};
 fs.unlinkSync(f.policyFile);
 for(const action of ['admit','disable','revoke']){
  const r=spawnSync('bash',[script,f.policy.id,action],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);const s=JSON.parse(r.stdout);assert.equal(s.state,'READBACK_VERIFIED');
  const installed=JSON.parse(fs.readFileSync(f.policyFile));assert.equal(installed.enabled,action==='admit');assert.equal(installed.revoked,action==='revoke');
 }
 const audit=fs.readFileSync(path.join(f.trust,'master-registry-audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(audit.map(x=>x.action),['admit','disable','revoke']);assert.ok(audit.every(x=>x.repository===f.policy.repository&&x.audit_identity===f.policy.audit_identity));
});
test('Host admission rejects Project-unregistered repository without installing entry',t=>{const f=master(t),script=path.resolve(__dirname,'../../scripts/host-gitops-register-master.sh');f.github.items.items=[];f.sync();fs.unlinkSync(f.policyFile);const r=spawnSync('bash',[script,f.policy.id],{env:{...f.env,PATH:f.root+':'+process.env.PATH},encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/MASTER_PROJECT_REPOSITORY_UNREGISTERED/);assert.equal(fs.existsSync(f.policyFile),false);});
test('legacy invalid SHA manual receipt still rejects after persistent extension',t=>{const f=fixture(t);delete f.request.delegation;fs.writeFileSync(f.receipt,'c'.repeat(40));const s=f.run();assert.equal(s.state,'FAIL');assert.equal(s.error,'DEPLOY_HOST_APPROVAL_SHA_MISMATCH');assert.equal(fs.existsSync(f.calls),false);assert.equal(fs.readFileSync(f.receipt,'utf8'),'c'.repeat(40));});
