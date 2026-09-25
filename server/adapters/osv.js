"use strict";
const cp=require('node:child_process');
function createOsvAdapter({command=process.env.DEBUG_AI_OSV_SCANNER||'osv-scanner',dbPath=process.env.DEBUG_AI_OSV_DB,spawnSync=cp.spawnSync}={}){return {scan(target){if(!dbPath)throw new Error('OSV_DB_REQUIRED');const r=spawnSync(command,['scan','--offline','--local-db',dbPath,'--format','json',target],{encoding:'utf8',timeout:120000});if(r.error)throw new Error(`OSV_EXEC_FAILED:${r.error.code||r.error.message}`);if(r.status!==0&&r.status!==1)throw new Error(`OSV_SCAN_FAILED:${r.status}:${String(r.stderr).slice(0,200)}`);let result;try{result=JSON.parse(r.stdout||'{}')}catch{throw new Error('OSV_INVALID_JSON')}return {exit_code:r.status,vulnerable:r.status===1,result};}}}
module.exports={createOsvAdapter};
