'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const runner=path.resolve(__dirname,'../../scripts/host-gitops-runner.sh'),helper=path.resolve(__dirname,'../../scripts/host-gitops-delegation.sh');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'delegated-gitops-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const repo=path.join(root,'repo'),trust=path.join(root,'trust'),approvals=path.join(root,'approvals'),queue=path.join(repo,'.debugai-input/gitops');
 for(const d of [repo,path.join(repo,'.git'),trust,path.join(trust,'policies'),approvals,path.join(queue,'requests')])fs.mkdirSync(d,{recursive:true,mode:0o700});
 const sha='a'.repeat(40),id='gitops_'+'b'.repeat(24),now=Date.now();
 const effects={destructive:false,persistent_data:false,secrets:false,provider_model:false,public_exposure:false};
 const policy={schema:'debugai.standing-delegation/v1',id:'dlg_test',issuer:'master:seigo-gace',authority:'gace-master',audit_identity:'master:seigo-gace/delegated:server-ai',repo:'/workspace/debug-ai',remote:'https://github.com/seigo-gace/debug-ai.git',branch:'feat/tgserver-async-log-sink-20261003',allowed_operations:['deploy'],allowed_scopes:['debugai.compose.reflect'],allow_production:true,effects,valid_from:now-10000,expires_at:now+600000,revoked:false,request_identity:'debugai.authenticated-control',allowed_paths:['scripts/','docs/']};
 const request={schema:'debugai.gitops-request/v1',id,action:'deploy',repo:policy.repo,branch:policy.branch,expected_head:sha,sha,human_approved:true,expires_at:now+60000,delegation:{id:policy.id,scope:policy.allowed_scopes[0],operation_id:id,request_identity:policy.request_identity,production:true,effects}};
 const policyFile=path.join(trust,'policies/dlg_test.json'),issuerFile=path.join(trust,'issuers.json'),requestFile=path.join(queue,`requests/${id}.json`),receipt=path.join(approvals,`${id}.approve`),calls=path.join(root,'calls');
 const write=(file,v)=>fs.writeFileSync(file,JSON.stringify(v),{mode:0o600});write(policyFile,policy);write(issuerFile,{schema:'debugai.delegation-issuers/v1',issuers:[{issuer:policy.issuer,authority:policy.authority,enabled:true}]});
 const git=path.join(root,'git'),docker=path.join(root,'docker'),curl=path.join(root,'curl');
 fs.writeFileSync(git,`#!/bin/sh\ncase "$1" in\nremote) echo '${policy.remote}';;\nls-remote) echo '${sha} refs/heads/${policy.branch}';;\nrev-parse) if [ -f '${root}/changed-head' ]; then cat '${root}/changed-head'; else echo '${sha}'; fi;;\ndiff) if [ "$#" -eq 4 ]; then if [ -f '${root}/forbidden-path' ]; then echo compose.yaml; else echo scripts/host-gitops-runner.sh; fi; fi;;\nls-files|fetch|merge-base) exit 0;;\ncheckout) echo checkout >> '${calls}';;\n*) exit 99;;\nesac\n`,{mode:0o700});
 fs.writeFileSync(docker,`#!/bin/sh\necho docker >> '${calls}'\nif [ "$1" = inspect ]; then echo 'running|healthy'; elif [ "$2" = ps ]; then echo test-container; fi\n`,{mode:0o700});fs.writeFileSync(curl,'#!/bin/sh\nprintf 200\n',{mode:0o700});
 const env={...process.env,DEBUG_AI_HOST_REPO:repo,DEBUG_AI_GITOPS_GIT_BIN:git,DEBUG_AI_GITOPS_DOCKER_BIN:docker,DEBUG_AI_GITOPS_CURL_BIN:curl,DEBUG_AI_GITOPS_APPROVAL_ROOT:approvals,DEBUG_AI_GITOPS_DELEGATION_ROOT:trust};
 const run=()=>{write(requestFile,request);const r=spawnSync('bash',[runner],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(fs.readFileSync(path.join(queue,`status/${id}.json`)));};
 const prepare=()=>{write(requestFile,request);const r=spawnSync('bash',['-c',`source '${runner.replaceAll("'","'\\''")}'`,],{env,encoding:'utf8'});return r;};
 const receiptCheck=(mutation='')=>{write(requestFile,request);const body=fs.readFileSync(runner,'utf8').replace(/main "\$@"\s*$/,'');const bootstrap=path.join(root,'runner-library.sh');fs.writeFileSync(bootstrap,body.replace('source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/host-gitops-delegation.sh"',`source '${helper}'`));return spawnSync('bash',['-c',`source '${bootstrap}'; request_id='${id}'; request_sha='${sha}'; issue_delegated_receipt '${requestFile}' '${sha}' '${receipt}' || { echo "$err_code"; exit 1; }; ${mutation}; consume_delegated_receipt '${requestFile}' '${receipt}' || { echo "$err_code"; exit 1; }; consume_delegated_receipt '${requestFile}' '${receipt}' || { echo "$err_code"; exit 1; }`],{env,encoding:'utf8'});};
 return {root,repo,trust,approvals,queue,sha,id,policy,request,policyFile,issuerFile,requestFile,receipt,calls,write,run,receiptCheck};
}
for(const [label,change,error] of [
 ['missing delegation',f=>delete f.request.delegation,'DEPLOY_HOST_APPROVAL_REQUIRED'],
 ['invalid issuer',f=>f.policy.issuer='untrusted','DELEGATION_ISSUER_INVALID'],
 ['revoked',f=>f.policy.revoked=true,'DELEGATION_REVOKED'],
 ['expired',f=>f.policy.expires_at=1,'DELEGATION_EXPIRED_OR_NOT_STARTED'],
 ['not started',f=>f.policy.valid_from=Date.now()+600000,'DELEGATION_EXPIRED_OR_NOT_STARTED'],
 ['wrong repository',f=>f.policy.repo='/workspace/other','DELEGATION_REPOSITORY_MISMATCH'],
 ['wrong branch',f=>f.policy.branch='other','DELEGATION_BRANCH_MISMATCH'],
 ['wrong operation',f=>f.policy.allowed_operations=['publish'],'DELEGATION_OPERATION_MISMATCH'],
 ['wrong scope',f=>f.request.delegation.scope='unlimited.shell','DELEGATION_SCOPE_MISMATCH'],
 ['production forbidden',f=>f.policy.allow_production=false,'DELEGATION_PRODUCTION_FORBIDDEN'],
 ['SHA mismatch',f=>f.request.sha='c'.repeat(40),'DEPLOY_SHA_INVALID'],
 ['operation id mismatch',f=>f.request.delegation.operation_id='gitops_'+'c'.repeat(24),'DELEGATION_OPERATION_ID_MISMATCH'],
 ['request identity mismatch',f=>f.request.delegation.request_identity='caller-text','DELEGATION_REQUEST_IDENTITY_MISMATCH'],
 ['protected effect',f=>f.request.delegation.effects.secrets=true,'DELEGATION_PROTECTED_EFFECT_FORBIDDEN'],
 ['out of source scope',f=>fs.writeFileSync(path.join(f.root,'forbidden-path'),'1'),'DELEGATION_CHANGED_PATH_FORBIDDEN'],
 ['unsafe policy permissions',f=>fs.chmodSync(f.policyFile,0o644),'DELEGATION_POLICY_UNTRUSTED'],
 ['unapproved request',f=>f.request.human_approved=false,'REQUEST_SCHEMA_OR_BOUNDARY_INVALID'],
 ['unauthorized shell',f=>f.request.action='shell','REQUEST_ACTION_INVALID'],
])test(`real Bash/jq delegated deploy rejects ${label} before mutation`,t=>{const f=fixture(t);change(f);f.write(f.policyFile,f.policy);const s=f.run();assert.equal(s.state,'FAIL');assert.equal(s.error,error);assert.equal(fs.existsSync(f.calls),false);assert.equal(fs.existsSync(f.receipt),false);});
test('real Bash/jq delegated deploy issues, binds, consumes and audits receipt, then rejects operation replay',t=>{const f=fixture(t),s=f.run();assert.equal(s.state,'PASS',s.error);assert.equal(s.authorization.delegation_id,'dlg_test');assert.equal(s.authorization.operation_id,f.id);assert.equal(s.authorization.sha,f.sha);assert.ok(s.authorization.receipt_consumed_at);assert.equal(fs.existsSync(f.receipt),false);assert.ok(fs.existsSync(f.receipt+'.used'));const calls=fs.readFileSync(f.calls,'utf8');const again=f.run();assert.deepEqual(again,s);assert.equal(fs.readFileSync(f.calls,'utf8'),calls);assert.match(fs.readFileSync(path.join(f.queue,`status/${f.id}.rejections.jsonl`),'utf8'),/GITOPS_OPERATION_REPLAY_REJECTED/);});
for(const [label,mutation,error] of [
 ['reuse','true','DELEGATION_RECEIPT_REUSED'],
 ['expired receipt',f=>`jq '.expires_at=1' '${f.receipt}' > '${f.root}/r'; cat '${f.root}/r' > '${f.receipt}'`,'DELEGATION_RECEIPT_EXPIRED'],
 ['target change',f=>`echo '${'d'.repeat(40)}' > '${f.root}/changed-head'`,'DELEGATION_TARGET_STATE_CHANGED'],
 ['policy change',f=>`jq '.audit_identity="changed"' '${f.policyFile}' > '${f.root}/p'; cat '${f.root}/p' > '${f.policyFile}'`,'DELEGATION_TARGET_STATE_CHANGED'],
 ['revoked after issuance',f=>`jq '.revoked=true' '${f.policyFile}' > '${f.root}/p'; cat '${f.root}/p' > '${f.policyFile}'`,'DELEGATION_REVOKED'],
 ['request changed',f=>`jq '.created_at=1' '${f.requestFile}' > '${f.root}/q'; cat '${f.root}/q' > '${f.requestFile}'`,'DELEGATION_TARGET_STATE_CHANGED'],
 ['receipt operation mismatch',f=>`jq '.operation_id="other"' '${f.receipt}' > '${f.root}/r'; cat '${f.root}/r' > '${f.receipt}'`,'DELEGATION_RECEIPT_OPERATION_ID_MISMATCH'],
 ['receipt identity mismatch',f=>`jq '.request_identity="other"' '${f.receipt}' > '${f.root}/r'; cat '${f.root}/r' > '${f.receipt}'`,'DELEGATION_RECEIPT_REQUEST_IDENTITY_MISMATCH'],
 ['receipt SHA mismatch',f=>`jq '.sha="${'e'.repeat(40)}"' '${f.receipt}' > '${f.root}/r'; cat '${f.root}/r' > '${f.receipt}'`,'DELEGATION_RECEIPT_SHA_MISMATCH'],
])test(`actual issued receipt rejects ${label}`,t=>{const f=fixture(t),r=f.receiptCheck(typeof mutation==='function'?mutation(f):mutation);assert.equal(r.status,1);assert.match(r.stdout,new RegExp(error),r.stderr);if(label!=='reuse')assert.equal(fs.existsSync(f.calls),false);});
for(const effect of ['destructive','persistent_data','provider_model','public_exposure'])test(`delegated deploy refuses protected ${effect} effect`,t=>{const f=fixture(t);f.request.delegation.effects[effect]=true;f.write(f.policyFile,f.policy);const s=f.run();assert.equal(s.error,'DELEGATION_PROTECTED_EFFECT_FORBIDDEN');assert.equal(fs.existsSync(f.calls),false);});
for(const [label,change,error] of [
 ['missing policy',f=>fs.unlinkSync(f.policyFile),'DELEGATION_POLICY_UNTRUSTED'],
 ['disabled issuer',f=>f.write(f.issuerFile,{schema:'debugai.delegation-issuers/v1',issuers:[{issuer:f.policy.issuer,authority:f.policy.authority,enabled:false}]}),'DELEGATION_ISSUER_INVALID'],
 ['symlinked policy',f=>{fs.renameSync(f.policyFile,f.policyFile+'.real');fs.symlinkSync(f.policyFile+'.real',f.policyFile)},'DELEGATION_POLICY_UNTRUSTED'],
 ['malformed policy',f=>fs.writeFileSync(f.policyFile,'{'),'DELEGATION_POLICY_INVALID'],
 ['used operation without status',f=>fs.writeFileSync(f.receipt+'.used','used'),'DELEGATION_RECEIPT_ALREADY_EXISTS_OR_USED'],
])test(`delegation trust boundary rejects ${label}`,t=>{const f=fixture(t);change(f);assert.equal(f.run().error,error);assert.equal(fs.existsSync(f.calls),false);});
test('revocation during image build stops production recreate after receipt consumption',t=>{const f=fixture(t),docker=path.join(f.root,'docker');fs.writeFileSync(docker,`#!/bin/sh\necho "$2" >> '${f.calls}'\nif [ "$2" = build ]; then jq '.revoked=true' '${f.policyFile}' > '${f.root}/p'; cat '${f.root}/p' > '${f.policyFile}'; fi\n`,{mode:0o700});const s=f.run();assert.equal(s.state,'FAIL');assert.equal(s.error,'DELEGATION_REVOKED');assert.ok(s.authorization.receipt_consumed_at);assert.ok(fs.existsSync(f.receipt+'.used'));assert.doesNotMatch(fs.readFileSync(f.calls,'utf8'),/\bup\b/);});
