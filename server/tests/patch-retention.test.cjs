"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {patchBackupRetention,writeRetentionReceipt,PASS_BACKUP_RETENTION_MS,FAIL_BACKUP_RETENTION_MS}=require("../patch-service.js");

test("patch backup retention is 72h after PASS and 7d after FAIL",()=>{
  const now=1_000_000,pass=patchBackupRetention({pass:true,verifiedAt:now}),fail=patchBackupRetention({pass:false,verifiedAt:now});
  assert.equal(pass.retention_ms,PASS_BACKUP_RETENTION_MS);assert.equal(pass.retain_until,now+72*3600e3);assert.equal(pass.verification_pass,true);
  assert.equal(fail.retention_ms,FAIL_BACKUP_RETENTION_MS);assert.equal(fail.retain_until,now+7*24*3600e3);assert.equal(fail.verification_pass,false);
});

test("patch retention receipt is private and written beside backup receipt",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-patch-retention-"));try{const receipt=patchBackupRetention({pass:true,verifiedAt:123}),file=writeRetentionReceipt(root,receipt),stat=fs.statSync(file);assert.equal(file,path.join(root,"retention.json"));assert.deepEqual(JSON.parse(fs.readFileSync(file,"utf8")),receipt);assert.equal(stat.mode&0o077,0);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
