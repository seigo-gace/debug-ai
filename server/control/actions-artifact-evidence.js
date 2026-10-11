"use strict";
const {parseArtifactZip,hash,LIMITS,fail}=require('./actions-artifact-zip.js');
const {scrub,safeRunId}=require('../runtime-evidence.js');
const {makeEvidenceRecord,assertEvidenceRecord}=require('./evidence-registry.js');
const {makeEvidenceProjection}=require('./evidence-projection.js');
function sanitizeArtifactText(value){
 return scrub(value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,'[REDACTED PRIVATE KEY]')
  .replace(/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,'[REDACTED]')
  .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,'$1[REDACTED]@')
  .replace(/((?:authorization|cookie|set-cookie)\s*[:=])[^\r\n]*/gi,'$1 [REDACTED]')
  .replace(/(^|\n)([ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=)[^\r\n]*/g,'$1$2[REDACTED]')
  .replace(/(["']?(?:password|passwd|token|secret|api[_-]?key)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,'$1[REDACTED]'));
}
function validId(value){if(!Number.isSafeInteger(value)||value<1)fail('ARTIFACT_ID_INVALID');return value;}
async function ingestActionsArtifact({repository,runId,artifactId,headSha,attempt,evidenceRunId,registry,reader,runtimeEvidence,tgserver,now=()=>new Date()}={}){
 if(typeof repository!=='string'||!/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(repository)||!/^[a-f0-9]{40}$/.test(headSha||''))fail('ARTIFACT_TARGET_INVALID');
 validId(runId);validId(artifactId);validId(attempt);safeRunId(evidenceRunId);
 if(!runtimeEvidence?.write||!tgserver?.log)fail('ARTIFACT_EVIDENCE_SINK_REQUIRED');
 const mapping=registry?.repositories?.filter(r=>r.repository===repository);if(mapping?.length!==1)fail('ARTIFACT_REPOSITORY_NOT_REGISTERED');const entry=mapping[0];
 if(entry.enabled!==true||entry.revoked!==false||entry.master_principal!==registry.master_principal||entry.project?.node_id!==registry.project?.node_id)fail('ARTIFACT_REPOSITORY_NOT_AUTHORIZED');
 const identity=await reader.json('user'),repo=await reader.json(`repos/${repository}`);
 if(registry.schema!=='gace.workspace-master-internal-registry/v1'||entry.schema!=='debugai.master-internal-delegation/v1')fail('ARTIFACT_REGISTRY_INVALID');
 if(identity.login!==entry.master_principal||repo.id!==entry.repository_id||repo.node_id!==entry.repository_node_id||repo.full_name!==repository||repo.owner?.login!==entry.repository_owner||repo.permissions?.admin!==true)fail('ARTIFACT_GITHUB_IDENTITY_MISMATCH');
 const project=await reader.project(entry.project.owner,entry.project.number);
 if(!project.items?.some(i=>i.id===entry.project.item_id&&i.content?.repository===repository&&i.content?.url===entry.project.control_url))fail('ARTIFACT_PROJECT_NOT_VERIFIED');
 const run=await reader.json(`repos/${repository}/actions/runs/${runId}`);
 if(run.id!==runId||run.repository?.id!==repo.id||run.head_repository?.id!==repo.id||run.head_sha!==headSha||run.run_attempt!==attempt||run.status!=='completed')fail('ARTIFACT_RUN_MISMATCH');
 // GitHub artifact metadata currently lacks attempt identity; do not guess rerun attribution.
 if(attempt!==1)fail('ARTIFACT_ATTEMPT_NOT_VERIFIED');
 const jobs=[];for(let page=1;page<=4;page++){const out=await reader.json(`repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`);if(!Array.isArray(out.jobs)||out.total_count>400)fail('ARTIFACT_JOBS_LIMIT');jobs.push(...out.jobs);if(jobs.length===out.total_count)break;if(page===4||out.jobs.length===0)fail('ARTIFACT_JOBS_INCOMPLETE');}
 if(jobs.some(j=>j.run_id!==runId||j.head_sha!==headSha||j.run_attempt!==attempt))fail('ARTIFACT_JOB_MISMATCH');
 const artifact=await reader.json(`repos/${repository}/actions/artifacts/${artifactId}`),received=now().toISOString();
 if(artifact.id!==artifactId||artifact.expired!==false||artifact.workflow_run?.id!==runId||artifact.workflow_run?.head_sha!==headSha||artifact.workflow_run?.head_repository_id!==repo.id||artifact.workflow_run?.repository_id!==repo.id||!Number.isSafeInteger(artifact.size_in_bytes)||artifact.size_in_bytes<22||artifact.size_in_bytes>LIMITS.archiveBytes||!Number.isFinite(Date.parse(artifact.created_at))||!Number.isFinite(Date.parse(artifact.expires_at))||Date.parse(artifact.expires_at)<=Date.parse(received)||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest||''))fail('ARTIFACT_METADATA_MISMATCH');
 const archive=await reader.download(repository,artifactId);
 if(archive.length!==artifact.size_in_bytes||`sha256:${hash(archive)}`!==artifact.digest)fail('ARTIFACT_DOWNLOAD_INTEGRITY');
 const freshRun=await reader.json(`repos/${repository}/actions/runs/${runId}`),freshArtifact=await reader.json(`repos/${repository}/actions/artifacts/${artifactId}`);
 if(freshRun.id!==runId||freshRun.head_sha!==headSha||freshRun.run_attempt!==attempt||freshRun.status!=='completed'||freshArtifact.id!==artifactId||freshArtifact.digest!==artifact.digest||freshArtifact.size_in_bytes!==artifact.size_in_bytes||freshArtifact.expired!==false||Date.parse(freshArtifact.expires_at)<=now().getTime())fail('ARTIFACT_CHANGED_DURING_DOWNLOAD');
 const parsed=parseArtifactZip(archive),records=[];
 const provenance={repository,github_run_id:runId,run_attempt:attempt,workflow_id:run.workflow_id,event:run.event,head_sha:headSha,run_conclusion:run.conclusion||'UNKNOWN',job_id:null,job_association:'UNKNOWN',jobs:jobs.map(j=>({id:j.id,conclusion:j.conclusion||'UNKNOWN'})),artifact_id:artifactId,artifact_name:sanitizeArtifactText(String(artifact.name||'')),artifact_created_at:artifact.created_at,artifact_expires_at:artifact.expires_at,archive_sha256:parsed.archive_sha256,received_at:received};
 for(const entry of parsed.entries){const sanitized=sanitizeArtifactText(entry.text),excerpt=sanitized.slice(0,12000);const payload={schema:'debugai.actions-artifact-entry/v1',...provenance,entry_path:entry.path,content_sha256:entry.content_sha256,sanitized_sha256:hash(Buffer.from(sanitized)),excerpt,truncated:sanitized.length>excerpt.length,content_trust:'DATA_NOT_INSTRUCTION',observed_outcome:'UNKNOWN'};records.push(makeEvidenceRecord('LOCAL_RUNTIME',payload));}
 // Validate everything before publishing any excerpts. Existing record cap and TTL own storage.
 const result={schema:'debugai.actions-artifact-intake/v1',evidence_run_id:evidenceRunId,provenance,records,evidence_ids:records.map(r=>r.evidence_id),localEvidence:records.map(r=>r.payload),diagnosis_input:records.map(r=>makeEvidenceProjection({parentEvidenceId:r.evidence_id,parentDigest:r.integrity.content_sha256,repositoryRevision:headSha,evidenceKind:'GITHUB_ACTIONS_ARTIFACT',source:r.payload.entry_path,content:r.payload.excerpt,provenanceStatus:'VERIFIED',observedOutcome:'UNKNOWN',projectionCompleteness:'PARTIAL'}))};
 if(Buffer.byteLength(JSON.stringify(result))>runtimeEvidence.maxRecordBytes)fail('ARTIFACT_EVIDENCE_RECORD_LIMIT');
 runtimeEvidence.write(evidenceRunId,'github_actions_artifact',result);
 await tgserver.log(scrub({run_id:evidenceRunId,kind:'github_actions_artifact',severity:'info',...provenance,evidence_ids:result.evidence_ids,entry_count:records.length,diagnosis_input_ready:true}));
 return result;
}
function loadArtifactEvidence(runtimeEvidence,runId,ids){safeRunId(runId);if(!Array.isArray(ids)||!ids.length||ids.length>128)fail('ARTIFACT_EVIDENCE_IDS_REQUIRED');const records=runtimeEvidence.list(runId,{types:['github_actions_artifact'],limit:128}).filter(r=>Date.now()-Date.parse(r.created_at)<=runtimeEvidence.retentionMs).flatMap(r=>r.payload.records||[]);return ids.map(id=>{const r=records.find(r=>r.evidence_id===id);if(!r)fail('ARTIFACT_EVIDENCE_NOT_AVAILABLE');assertEvidenceRecord(r);return r.payload;});}
module.exports={ingestActionsArtifact,loadArtifactEvidence,sanitizeArtifactText};
