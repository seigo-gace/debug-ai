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
 const ghCalls=path.join(f.root,'gh-calls');
 const gh=path.join(f.root,'gh');fs.writeFileSync(gh,`#!/bin/sh\nprintf '%s %s\\n' "$1" "$2" >> '${ghCalls}'\ncase "$1 $2" in\n'api user') jq -r .login '${githubFile}';;\n'api repos/'*) jq .metadata '${githubFile}';;\n'api graphql') jq '. as $g | {errors:(.errors//[]),data:{node: (if (.items.items|length)>0 then .items.items[0] | {__typename: \"ProjectV2Item\",id,isArchived:(.isArchived//false),project:(.project//$g.project),content:{__typename:(.content.type//\"Issue\"),url:.content.url,repository:{nameWithOwner:.content.repository}}} else null end)}}' '${githubFile}';;\n'project view') jq .project '${githubFile}';;\n'project item-list') jq .items '${githubFile}';;\n*) exit 90;;\nesac\n`,{mode:0o700});
 const docker=path.join(f.root,'docker');fs.writeFileSync(docker,`#!/bin/sh\nif [ "$2" = config ]; then printf 'debug-ai\\nsandbox-runner\\n'; exit 0; fi\necho "$2" >> '${f.calls}'\nif [ "$1" = inspect ]; then echo 'running|healthy'; elif [ "$2" = ps ]; then echo test-container; fi\n`,{mode:0o700});
 Object.assign(f.env,{DEBUG_AI_GITOPS_GH_BIN:gh,DEBUG_AI_MASTER_REGISTRY:registryFile,DEBUG_AI_MASTER_PROJECT_ROOT:f.root});
 const sync=()=>{f.write(f.policyFile,f.policy);f.write(registryFile,registry);f.write(githubFile,github);};sync();
 return Object.assign(f,{registry,registryFile,github,githubFile,ghCalls,sync});
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

test('another registered Master repo uses explicit server mapping and its own branch/runtime identity',t=>{const f=master(t);f.policy.repository='seigo-gace/another-master';f.policy.repository_id=456;f.policy.repository_node_id='R_another';f.policy.remote='https://github.com/seigo-gace/another-master.git';f.policy.server_project_id='AnotherProject';f.policy.allowed_branches=['main'];f.policy.project.control_url='https://github.com/seigo-gace/another-master/issues/1';f.policy.runtime_target.id='another.compose';f.request.branch='main';f.request.delegation.repository=f.policy.repository;f.request.delegation.runtime_target=f.policy.runtime_target.id;Object.assign(f.github.metadata,{full_name:f.policy.repository,id:456,node_id:'R_another'});f.github.items.items[0].content={repository:f.policy.repository,url:f.policy.project.control_url};const git=path.join(f.root,'git');fs.writeFileSync(git,fs.readFileSync(git,'utf8').replaceAll('https://github.com/seigo-gace/debug-ai.git',f.policy.remote));f.sync();const s=f.run();assert.equal(s.state,'PASS',s.error);assert.equal(s.authorization.repository,f.policy.repository);assert.equal(s.authorization.server_project_id,'AnotherProject');assert.equal(s.authorization.server_project_path,f.repo);assert.equal(s.authorization.branch,'main');assert.equal(s.authorization.runtime_target,'another.compose');});

test('existing MCP simple reference selects persistent mode only from installed Master registry',t=>{const f=master(t);delete f.request.delegation.mode;delete f.request.delegation.repository;delete f.request.delegation.runtime_target;f.request.branch='main';f.policy.allowed_branches=['main'];f.sync();const s=f.run();assert.equal(s.state,'PASS',s.error);assert.equal(s.authorization.delegation_mode,'MASTER_INTERNAL_PERSISTENT');assert.equal(s.authorization.repository,f.policy.repository);assert.equal(s.authorization.runtime_target,f.policy.runtime_target.id);});


function sourceOnlyMaster(t){
  const f=master(t);
  const before='c'.repeat(40), git=path.join(f.root,'git');
  f.policy.allowed_operations=['reflect'];
  f.policy.allowed_scopes=['gace.source.reflect'];
  f.policy.runtime_target={id:'tgserver.source',kind:'source_only'};
  f.request.action='reflect';
  f.request.delegation.scope='gace.source.reflect';
  f.request.delegation.runtime_target='tgserver.source';
  // Existing Fixture is a deterministic Git mock. Its initial checkout is
  // behind target; fetching proves exact SHA and detached switch changes HEAD.
  let script=fs.readFileSync(git,'utf8');
  const old=`rev-parse) if [ -f '${f.root}/changed-head' ]; then cat '${f.root}/changed-head'; else echo '${f.sha}'; fi;;`;
  const next=`rev-parse) if [ "$2" = FETCH_HEAD ]; then echo '${f.sha}'; elif [ -f '${f.root}/changed-head' ]; then cat '${f.root}/changed-head'; else echo '${before}'; fi;;`;
  assert.ok(script.includes(old));script=script.replace(old,next);
  script=script.replace("checkout) echo checkout >> '"+f.calls+"';;", "checkout) echo '"+f.sha+"' > '"+f.root+"/changed-head'; echo checkout >> '"+f.calls+"';;");
  fs.writeFileSync(git,script,{mode:0o700});
  f.sync();
  return f;
}
test('registered Project source-only policy reflects exact commit without Docker Compose',t=>{
  const f=sourceOnlyMaster(t);
  const s=f.run();
  assert.equal(s.state,'PASS',s.error);
  assert.equal(s.action,'reflect');
  assert.equal(s.result.reflected_sha,f.sha);
  assert.equal(s.result.active_checkout_verified,true);
  assert.equal(s.result.runtime_restarted,false);
  assert.ok(s.result.changed_paths.includes('scripts/host-gitops-runner.sh'));
  assert.equal(s.authorization.runtime_target,'tgserver.source');
  assert.match(fs.readFileSync(f.calls,'utf8'),/checkout/);
  assert.doesNotMatch(fs.readFileSync(f.calls,'utf8'),/docker/);
});
for(const [label,mutate,error] of [
  ['unregistered project',f=>{f.github.items.items=[]},'MASTER_PROJECT_REPOSITORY_UNREGISTERED'],
  ['wrong runtime target',f=>{f.request.delegation.runtime_target='debugai.compose'},'MASTER_RUNTIME_TARGET_FORBIDDEN'],
  ['revoked registration',f=>{f.policy.revoked=true},'MASTER_DELEGATION_DISABLED_OR_REVOKED'],
  ['scope mismatch',f=>{f.request.delegation.scope='debugai.compose.reflect'},'MASTER_SCOPE_FORBIDDEN'],
  ['unexpected Compose settings',f=>{f.policy.runtime_target.compose_file='compose.yaml'},'MASTER_RUNTIME_POLICY_INVALID'],
  ['branch forbidden',f=>{f.request.branch='main'},'MASTER_BRANCH_FORBIDDEN'],
  ['forbidden changed path',f=>{fs.writeFileSync(path.join(f.root,'forbidden-path'),'1')},'MASTER_PROTECTED_PATH_FORBIDDEN'],
])test('source-only reflection fails closed: '+label,t=>{
  const f=sourceOnlyMaster(t);mutate(f);f.sync();
  const s=f.run();assert.equal(s.state,'FAIL',JSON.stringify(s));assert.equal(s.error,error);
  assert.equal(fs.existsSync(f.calls),false);
});


test('fresh admission reads only the registered Project item rather than unrelated board bodies',t=>{
 const f=master(t),s=f.run();assert.equal(s.state,'PASS',s.error);
 const reads=fs.readFileSync(f.ghCalls,'utf8');
 assert.match(reads,/api graphql/);assert.doesNotMatch(reads,/project item-list|project view/);
});
for(const [label,change,error] of [
 ['archived controlling item',f=>f.github.items.items[0].isArchived=true,'MASTER_PROJECT_REPOSITORY_UNREGISTERED'],
 ['item in another Project',f=>f.github.items.items[0].project={...f.github.project,id:'other'},'MASTER_PROJECT_MISMATCH'],
 ['draft item masquerading as repository control',f=>f.github.items.items[0].content.type='DraftIssue','MASTER_PROJECT_REPOSITORY_UNREGISTERED']
])test('targeted Project identity read rejects '+label,t=>{
 const f=master(t);change(f);f.sync();const s=f.run();assert.equal(s.state,'FAIL');assert.equal(s.error,error);assert.equal(fs.existsSync(f.calls),false);assert.equal(fs.existsSync(f.receipt),false);
});
function failingGraphql(f,{status=504,recover=false}={}){
 const gh=f.env.DEBUG_AI_GITOPS_GH_BIN,count=path.join(f.root,'gateway-calls');
 const original=fs.readFileSync(gh,'utf8');
 const preamble=`if [ "$1 $2" = 'api graphql' ] || [ "$1 $2" = 'project view' ] || [ "$1 $2" = 'project item-list' ]; then n=0; [ ! -f '${count}' ] || n=$(cat '${count}'); n=$((n+1)); echo "$n" > '${count}'; if [ "$n" -eq 1 ] || [ '${recover}' != true ]; then printf 'FAILED_PARTIAL_RESPONSE\\n'; printf 'non-200 OK status code: ${status} Gateway failure\\n' >&2; exit 1; fi; fi\n`;
 fs.writeFileSync(gh,original.replace('#!/bin/sh\n','#!/bin/sh\n'+preamble),{mode:0o700});return count;
}
test('one read-only 504 retry discards failed response and still performs all live admission gates',t=>{
 const f=master(t),count=failingGraphql(f,{recover:true}),s=f.run();assert.equal(s.state,'PASS',s.error);assert.ok(Number(fs.readFileSync(count,'utf8'))>=2);assert.ok(s.authorization.receipt_consumed_at);
});
for(const status of [401,403,504])test('unavailable or denied GitHub item read never creates authority: HTTP'+status,t=>{
 const f=master(t),count=failingGraphql(f,{status}),s=f.run();assert.equal(s.state,'FAIL');assert.equal(s.error,'MASTER_PROJECT_NOT_VERIFIED');assert.equal(Number(fs.readFileSync(count,'utf8')),status===504?2:1);assert.equal(fs.existsSync(f.calls),false);assert.equal(fs.existsSync(f.receipt),false);
});

for(const [label,change,error] of [
 ['partial response with GraphQL errors',f=>f.github.errors=[{message:'unavailable'}],'MASTER_PROJECT_NOT_VERIFIED'],
 ['wrong item identity',f=>f.github.items.items[0].id='other','MASTER_PROJECT_REPOSITORY_UNREGISTERED'],
 ['wrong controlling repository',f=>f.github.items.items[0].content.repository='other/repo','MASTER_PROJECT_REPOSITORY_UNREGISTERED'],
 ['wrong control URL',f=>f.github.items.items[0].content.url+='0','MASTER_PROJECT_REPOSITORY_UNREGISTERED'],
 ['closed Project',f=>f.github.project.closed=true,'MASTER_PROJECT_MISMATCH'],
 ['different Project owner',f=>f.github.project.owner.login='other','MASTER_PROJECT_MISMATCH'],
 ['different Project number',f=>f.github.project.number=2,'MASTER_PROJECT_MISMATCH']
])test('targeted metadata fails closed: '+label,t=>{
 const f=master(t);change(f);f.sync();const s=f.run();assert.equal(s.state,'FAIL');assert.equal(s.error,error);assert.equal(fs.existsSync(f.calls),false);assert.equal(fs.existsSync(f.receipt),false);
});
function isolatedMetadataRead(t,args,{elapsed=false}={}){
 const f=master(t),count=path.join(f.root,'read-count'),clock=path.join(f.root,'clock-count');
 fs.writeFileSync(f.env.DEBUG_AI_GITOPS_GH_BIN,`#!/bin/sh\nn=0; [ ! -f '${count}' ] || n=$(cat '${count}'); echo $((n+1)) > '${count}'; echo 'non-200 OK status code: 504 Gateway Timeout' >&2; exit 1\n`,{mode:0o700});
 const helper=path.resolve(__dirname,'../../scripts/host-gitops-master-internal.sh');
 const fakeClock=elapsed?`date(){ local n=0; [ ! -f '${clock}' ] || n=$(cat '${clock}'); n=$((n+1)); echo "$n" > '${clock}'; if [ "$n" -lt 3 ]; then echo 100000; else echo 130001; fi; };`:'';
 const result=spawnSync('bash',['-c',`source "$1"; shift; GH_BIN="$1"; shift; run_timed(){ shift; "$@"; }; ${fakeClock} master_gh "$@"`,'metadata-test',helper,f.env.DEBUG_AI_GITOPS_GH_BIN,...args],{encoding:'utf8',env:f.env});
 return {result,calls:Number(fs.readFileSync(count,'utf8'))};
}
test('a gateway failure cannot reset the shared thirty-second metadata budget',t=>{
 const {result,calls}=isolatedMetadataRead(t,['api','graphql','-f','query=query($id:ID!){node(id:$id){id}}','-f','id=item_test'],{elapsed:true});
 assert.notEqual(result.status,0);assert.equal(calls,1);assert.equal(result.stdout,'');
});
for(const args of [
 ['api','graphql','-f','query=mutation{deleteProjectV2(input:{projectId:"x"}){clientMutationId}}','-f','id=item_test'],
 ['api','repos/owner/repo','--method','PATCH'],
 ['api','graphql','--input','unknown.json']
])test('non-admission command is never replayed on a gateway error: '+args.join(' '),t=>{
 const {result,calls}=isolatedMetadataRead(t,args);assert.notEqual(result.status,0);assert.equal(calls,1);
});
