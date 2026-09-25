const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TypeScript7LspClient}=require('../adapters/typescript-lsp.js');
test('TypeScript 7.0.2 native LSP real definition/reference',async(t)=>{
  if(process.env.DEBUG_AI_REQUIRE_TS7_REAL!=='1'){t.skip('real TS7 gate enabled in GitHub CI');return;}
  const pkg=require('typescript/package.json');assert.equal(pkg.version,'7.0.2');
  const cmd=path.join(__dirname,'..','..','node_modules','.bin','tsc');const repo=fs.mkdtempSync(path.join(os.tmpdir(),'ts7-real-')),file=path.join(repo,'a.ts');fs.writeFileSync(file,'export function foo(x:number){return x+1}\nexport const y=foo(2)\n');
  const c=new TypeScript7LspClient({rootDir:repo,command:cmd,timeoutMs:15000});try{await c.start();c.open(file);const syms=await c.documentSymbols(file);assert.ok(Array.isArray(syms)&&syms.some(x=>x.name==='foo'));assert.ok((await c.definition(file,'foo')).length>=1);assert.ok((await c.references(file,'foo')).length>=2);}finally{await c.stop();}
});
