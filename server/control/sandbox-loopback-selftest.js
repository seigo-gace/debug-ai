"use strict";
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const cp=require("node:child_process");

function runHelper({allowLoopback}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-loopback-"));
  const tmp=path.join(root,"tmp");fs.mkdirSync(tmp,{recursive:true});
  const script=path.join(root,"probe.cjs");
  const inner=`const fs=require('node:fs');\nconst path=require('node:path');\nconst net=require('node:net');\nconst dgram=require('node:dgram');\nasync function connectLocal(){return new Promise((resolve,reject)=>{const server=net.createServer(s=>{s.end('ok')});server.listen(0,'127.0.0.1',()=>{const port=server.address().port;const client=net.createConnection({host:'127.0.0.1',port},()=>{});let data='';client.on('data',c=>data+=c);client.on('end',()=>{server.close();if(data==='ok')resolve();else reject(new Error('LOOPBACK_BAD_DATA'))});client.on('error',reject)});server.on('error',reject)})}\nasync function unixTmpMustWork(){return new Promise((resolve,reject)=>{const socketPath=path.join(process.env.TMPDIR,'debugai-dap-test.sock');try{fs.rmSync(socketPath,{force:true})}catch{}const server=net.createServer(s=>s.end('ok'));server.once('error',reject);server.listen(socketPath,()=>{const client=net.createConnection(socketPath);let data='';client.on('data',c=>data+=c);client.on('end',()=>{server.close(()=>{try{fs.rmSync(socketPath,{force:true})}catch{};data==='ok'?resolve():reject(new Error('UNIX_SOCKET_BAD_DATA'))})});client.on('error',reject)})})}\nasync function unixOutsideTmpMustFail(){return new Promise((resolve,reject)=>{const socketPath=path.join(process.cwd(),'blocked.sock');try{fs.rmSync(socketPath,{force:true})}catch{}const server=net.createServer();let settled=false;const finish=e=>{if(settled)return;settled=true;try{server.close()}catch{};try{fs.rmSync(socketPath,{force:true})}catch{};if(e&&['EPERM','EACCES'].includes(e.code))resolve();else reject(e||new Error('UNIX_SOCKET_OUTSIDE_TMP_ALLOWED'))};server.once('error',finish);try{server.listen(socketPath,()=>finish())}catch(e){finish(e)}})}\nasync function externalMustFail(){return new Promise((resolve,reject)=>{let settled=false;const s=net.createConnection({host:'1.1.1.1',port:443});const timer=setTimeout(()=>{if(settled)return;settled=true;s.destroy();resolve();},800);s.once('connect',()=>{if(settled)return;settled=true;clearTimeout(timer);s.destroy();reject(new Error('EXTERNAL_TCP_CONNECTED'))});s.once('error',()=>{if(settled)return;settled=true;clearTimeout(timer);resolve()})})}\nasync function udpMustFail(){return new Promise((resolve,reject)=>{let s;try{s=dgram.createSocket('udp4')}catch(e){return ['EPERM','EACCES'].includes(e.code)?resolve():reject(e)};s.once('error',e=>{try{s.close()}catch{};['EPERM','EACCES'].includes(e.code)?resolve():reject(e)});try{s.bind(0,'127.0.0.1',()=>{try{s.close()}catch{};reject(new Error('UDP_ALLOWED'))})}catch(e){try{s.close()}catch{};['EPERM','EACCES'].includes(e.code)?resolve():reject(e)}})}\n(async()=>{await connectLocal();await unixTmpMustWork();await unixOutsideTmpMustFail();await externalMustFail();await udpMustFail();console.log('SANDBOX_LOOPBACK_TCP=PASS');console.log('SANDBOX_UNIX_TMP=PASS');console.log('SANDBOX_UNIX_OUTSIDE_TMP=BLOCKED');console.log('SANDBOX_EXTERNAL_TCP=BLOCKED');console.log('SANDBOX_UDP=BLOCKED')})().catch(e=>{console.error(e.stack||String(e));process.exit(31)});\n`;
  fs.writeFileSync(script,inner);
  const args=["--snapshot",root,"--tmp",tmp,"--timeout-ms","10000"];
  if(allowLoopback)args.push("--allow-loopback-tcp");
  args.push("--",process.execPath,script);
  const r=cp.spawnSync(process.env.DEBUG_AI_SANDBOX_COMMAND||"/usr/local/bin/debugai-sandbox-exec",args,{encoding:"utf8",env:{PATH:process.env.PATH||"/usr/local/bin:/usr/bin:/bin",TMPDIR:tmp}});
  fs.rmSync(root,{recursive:true,force:true});
  return r;
}
function main(){
  const strict=runHelper({allowLoopback:false});
  if(strict.status===0)throw new Error("STRICT_PROFILE_UNEXPECTED_SOCKET_ACCESS");
  const dap=runHelper({allowLoopback:true});
  if(dap.status!==0)throw new Error(`LOOPBACK_PROFILE_FAILED:${dap.status}:${dap.stderr||dap.stdout}`);
  for(const marker of ["SANDBOX_LOOPBACK_TCP=PASS","SANDBOX_UNIX_TMP=PASS","SANDBOX_UNIX_OUTSIDE_TMP=BLOCKED","SANDBOX_EXTERNAL_TCP=BLOCKED","SANDBOX_UDP=BLOCKED"]){if(!String(dap.stdout).includes(marker))throw new Error(`MARKER_MISSING:${marker}`)}
  console.log("SANDBOX_STRICT_SOCKET_DENY=PASS");
  console.log("SANDBOX_DAP_LOOPBACK_ONLY=PASS");
}
try{main()}catch(e){console.error(e.stack||String(e));process.exit(1)}
