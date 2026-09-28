"use strict";
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const {prepareSandboxJob,readSandboxResult,probeSandboxHelper}=require("./sandbox-runtime.js");
const {runOnce}=require("./sandbox-sidecar.js");

function clearJobRootContents(jobRoot){
  if(!fs.existsSync(jobRoot))return;
  for(const name of fs.readdirSync(jobRoot))fs.rmSync(path.join(jobRoot,name),{recursive:true,force:true});
}

async function main(){
  const jobRoot=process.env.DEBUG_AI_SANDBOX_JOB_ROOT||"/sandbox-jobs",source=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-original-repo-")),guard="/tmp/debugai-original-guard";
  fs.mkdirSync(jobRoot,{recursive:true});fs.writeFileSync(guard,"ORIGINAL_GUARD\n");
  try{
    const inner=`const fs=require('node:fs');\nconst net=require('node:net');\nconst dgram=require('node:dgram');\nfunction deny(label,fn){try{fn();throw new Error(label+'_ALLOWED')}catch(e){if(e&&e.message===label+'_ALLOWED')throw e;if(!['EACCES','EPERM','ENOENT'].includes(e&&e.code))throw e;}}\nfunction tcp(){return new Promise((resolve,reject)=>{let settled=false,client=null;const server=net.createServer(socket=>socket.end());const timer=setTimeout(()=>finish(new Error('LOOPBACK_TCP_TIMEOUT')),1000);function finish(err){if(settled)return;settled=true;clearTimeout(timer);try{if(client)client.destroy()}catch{};try{server.close(()=>err?reject(err):resolve())}catch{err?reject(err):resolve()}}server.once('error',finish);server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address!=='object'||!Number.isInteger(address.port))return finish(new Error('LOOPBACK_TCP_ADDRESS_INVALID'));try{client=net.createConnection({host:'127.0.0.1',port:address.port});}catch(e){return finish(e)}client.once('connect',()=>finish(null));client.once('error',finish);});});}\nfunction udp(){return new Promise((resolve,reject)=>{let s;try{s=dgram.createSocket('udp4');}catch(e){if(['EACCES','EPERM'].includes(e.code))return resolve();return reject(e)}const timer=setTimeout(()=>{try{s.close()}catch{};reject(new Error('UDP_SOCKET_NOT_BLOCKED'))},1000);s.once('error',e=>{clearTimeout(timer);try{s.close()}catch{};if(['EACCES','EPERM'].includes(e.code))resolve();else reject(e)});try{s.bind(0,'127.0.0.1',()=>{clearTimeout(timer);try{s.close()}catch{};reject(new Error('UDP_BIND_ALLOWED'))})}catch(e){clearTimeout(timer);try{s.close()}catch{};if(['EACCES','EPERM'].includes(e.code))resolve();else reject(e)}});}\n(async()=>{fs.writeFileSync('inside-sandbox.txt','ok');if(fs.existsSync('/workspace'))throw new Error('WORKSPACE_PATH_VISIBLE');if(fs.existsSync('/run/secrets'))throw new Error('SECRET_PATH_VISIBLE');deny('ORIGINAL_READ',()=>fs.readFileSync('/tmp/debugai-original-guard'));deny('ORIGINAL_CHMOD',()=>fs.chmodSync('/tmp/debugai-original-guard',0o777));if(process.kill(process.ppid,0)!==true)throw new Error('SIGNAL0_PROBE_NOT_ALLOWED');deny('SIGNAL',()=>process.kill(process.ppid,'SIGCONT'));await tcp();await udp();console.log('SANDBOX_INNER_WRITE=PASS');console.log('SANDBOX_WORKSPACE_ABSENT=PASS');console.log('SANDBOX_SECRETS_ABSENT=PASS');console.log('SANDBOX_ORIGINAL_FS_DENY=PASS');console.log('SANDBOX_SIGNAL0_PROBE_ALLOWED=PASS');console.log('SANDBOX_SIGNAL_DENY=PASS');console.log('SANDBOX_LOOPBACK_TCP_ALLOWED=PASS');console.log('SANDBOX_UDP_DENY=PASS');})().catch(e=>{console.error(e.stack||String(e));process.exit(23)});\n`;
    fs.writeFileSync(path.join(source,"package.json"),JSON.stringify({name:"sandbox-selftest",private:true,scripts:{test:"node sandbox.test.cjs"}},null,2));
    fs.writeFileSync(path.join(source,"sandbox.test.cjs"),inner);fs.writeFileSync(path.join(source,"source-marker.txt"),"SOURCE_UNCHANGED\n");
    const before=crypto.createHash("sha256").update(fs.readFileSync(path.join(source,"source-marker.txt"))).digest("hex"),probe=probeSandboxHelper();if(!probe.available)throw new Error(`SANDBOX_HELPER_PROBE_FAILED:${probe.details||probe.error||probe.code}`);
    const job=prepareSandboxJob({sourceRepo:source,jobRoot,action:"package.test",timeoutMs:15000});const executed=runOnce({jobRoot});if(!executed)throw new Error("SANDBOX_JOB_NOT_EXECUTED");const result=readSandboxResult({jobRoot,jobId:job.job_id});if(!result||!result.pass)throw new Error(`SANDBOX_EXEC_FAILED:${result?.code}:${result?.stderr||"missing"}`);
    const after=crypto.createHash("sha256").update(fs.readFileSync(path.join(source,"source-marker.txt"))).digest("hex");if(before!==after)throw new Error("SOURCE_REPO_HASH_CHANGED");if(fs.existsSync(path.join(source,"inside-sandbox.txt")))throw new Error("SOURCE_REPO_MUTATED");if(fs.readFileSync(guard,"utf8")!=="ORIGINAL_GUARD\n")throw new Error("ORIGINAL_GUARD_MUTATED");
    for(const marker of ["SANDBOX_INNER_WRITE=PASS","SANDBOX_WORKSPACE_ABSENT=PASS","SANDBOX_SECRETS_ABSENT=PASS","SANDBOX_ORIGINAL_FS_DENY=PASS","SANDBOX_SIGNAL0_PROBE_ALLOWED=PASS","SANDBOX_SIGNAL_DENY=PASS","SANDBOX_LOOPBACK_TCP_ALLOWED=PASS","SANDBOX_UDP_DENY=PASS"]){if(!result.stdout.includes(marker))throw new Error(`SANDBOX_MARKER_MISSING:${marker}`);}
    console.log(`LANDLOCK_ABI=${probe.landlock_abi}`);console.log("SANDBOX_SOURCE_REPO_HASH=UNCHANGED");console.log("SANDBOX_DOCKER_SOCKET=ABSENT");console.log("SANDBOX_REAL_ISOLATION=PASS");
  }finally{fs.rmSync(source,{recursive:true,force:true});fs.rmSync(guard,{force:true});clearJobRootContents(jobRoot);}
}
main().catch(error=>{console.error(error.stack||String(error));process.exit(1);});
