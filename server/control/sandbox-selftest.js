"use strict";
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {executeSandboxed,probeBubblewrap}=require("./sandbox-runtime.js");

async function main(){
  const runtimeRoot=process.env.DEBUG_AI_RUNTIME_ROOT||path.join(os.tmpdir(),"debugai-sandbox-runtime");
  fs.mkdirSync(runtimeRoot,{recursive:true});
  const source=fs.mkdtempSync(path.join(runtimeRoot,"sandbox-source-"));
  try{
    fs.writeFileSync(path.join(source,"package.json"),JSON.stringify({name:"sandbox-selftest",private:true,scripts:{test:"node sandbox.test.cjs"}},null,2));
    fs.writeFileSync(path.join(source,"sandbox.test.cjs"),`const fs=require('node:fs');\n(async()=>{\nfs.writeFileSync('inside-sandbox.txt','ok');\nif(fs.existsSync('/workspace')){console.error('WORKSPACE_VISIBLE');process.exit(20)}\nif(fs.existsSync('/run/secrets')){console.error('SECRETS_VISIBLE');process.exit(21)}\nlet networkBlocked=false;\ntry{await fetch('https://example.com',{signal:AbortSignal.timeout(2000)})}catch{networkBlocked=true}\nif(!networkBlocked){console.error('NETWORK_AVAILABLE');process.exit(22)}\nconsole.log('SANDBOX_INNER_WRITE=PASS');\nconsole.log('SANDBOX_WORKSPACE_ABSENT=PASS');\nconsole.log('SANDBOX_SECRETS_ABSENT=PASS');\nconsole.log('SANDBOX_NETWORK_BLOCKED=PASS');\n})().catch(e=>{console.error(e.stack||String(e));process.exit(23)});\n`);
    const probe=probeBubblewrap();if(!probe.available)throw new Error(`BWRAP_PROBE_FAILED:${probe.error||probe.code}`);
    const result=executeSandboxed({repo:source,runtimeRoot,action:"package.test",timeoutMs:15000});
    if(!result.pass)throw new Error(`SANDBOX_EXEC_FAILED:${result.code}:${result.stderr}`);
    if(fs.existsSync(path.join(source,"inside-sandbox.txt")))throw new Error("SOURCE_REPO_MUTATED");
    for(const marker of ["SANDBOX_INNER_WRITE=PASS","SANDBOX_WORKSPACE_ABSENT=PASS","SANDBOX_SECRETS_ABSENT=PASS","SANDBOX_NETWORK_BLOCKED=PASS"]){if(!result.stdout.includes(marker))throw new Error(`SANDBOX_MARKER_MISSING:${marker}`);}
    console.log(`BWRAP_VERSION=${probe.version}`);
    console.log("SANDBOX_SOURCE_REPO_MUTATION=NONE");
    console.log("SANDBOX_REAL_ISOLATION=PASS");
  }finally{fs.rmSync(source,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack||String(error));process.exit(1);});
