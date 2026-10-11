"use strict";
const {execFile}=require('node:child_process');
const {LIMITS,fail}=require('./actions-artifact-zip.js');
// Use the already authenticated Host gh installation; never print stderr or credentials.
function createGhArtifactReader({execImpl=execFile}={}){
 async function gh(args,maxBuffer=2*1024**2){return new Promise((resolve,reject)=>execImpl('gh',args,{encoding:null,env:{...process.env,GH_HOST:'github.com'},timeout:30000,maxBuffer,windowsHide:true},(error,stdout)=>{if(error){const e=new Error('ARTIFACT_GITHUB_READ_FAILED');e.code='ARTIFACT_GITHUB_READ_FAILED';reject(e);}else resolve(stdout);}));}
 async function json(endpoint){try{return JSON.parse((await gh(['api','--hostname','github.com','--method','GET',endpoint])).toString('utf8'));}catch{fail('ARTIFACT_GITHUB_METADATA_UNAVAILABLE');}}
 async function project(owner,number){try{return JSON.parse((await gh(['project','item-list',String(number),'--owner',owner,'--limit','100','--format','json'])).toString('utf8'));}catch{fail('ARTIFACT_PROJECT_NOT_VERIFIED');}}
 return {json,project,download:(repository,id)=>gh(['api','--hostname','github.com','--method','GET',`repos/${repository}/actions/artifacts/${id}/zip`],LIMITS.archiveBytes)};
}
module.exports={createGhArtifactReader};
