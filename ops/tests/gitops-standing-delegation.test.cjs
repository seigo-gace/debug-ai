'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const runner=path.resolve(__dirname,'../../scripts/host-gitops-runner.sh'),helper=path.resolve(__dirname,'../../scripts/host-gitops-delegation.sh');
const {fixture}=require('./fixtures/gitops-delegation-fixture.cjs');
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
