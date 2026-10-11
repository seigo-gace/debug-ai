"use strict";
// Restricted ZIP reader: no filesystem extraction and no executable payloads.
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const {TextDecoder}=require('node:util');
const LIMITS=Object.freeze({archiveBytes:4*1024**2,entryBytes:2*1024**2,totalBytes:8*1024**2,entries:128,ratio:200,depth:8});
function fail(code){const e=new Error(code);e.code=code;throw e;}
function hash(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function text(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('ARTIFACT_TEXT_ENCODING');}}
function safePath(bytes){const name=text(bytes);if(!name||name.length>240||/[\\\x00-\x1f\x7f:]/.test(name)||name.startsWith('/'))fail('ARTIFACT_PATH_UNSAFE');const parts=name.replace(/\/$/,'').split('/');if(parts.length>LIMITS.depth||parts.some(p=>!p||p==='.'||p==='..'||p.endsWith('.')||p.endsWith(' ')||p.normalize('NFC')!==p||/^\.(git|env)(\.|$)/i.test(p)||/secret|credential|private.?key|id_rsa/i.test(p)))fail('ARTIFACT_PATH_UNSAFE');if(!name.endsWith('/')&&!/\.(log|txt|json|xml|tap|junit)$/i.test(name))fail('ARTIFACT_FILE_FORBIDDEN');return name;}
function extras(bytes){let i=0;while(i<bytes.length){if(i+4>bytes.length)fail('ARTIFACT_ZIP_EXTRA');const id=bytes.readUInt16LE(i),n=bytes.readUInt16LE(i+2);if([0x0001,0x000d,0x756e,0x7075,0x9901].includes(id)||i+4+n>bytes.length)fail('ARTIFACT_ZIP_EXTRA');i+=4+n;}}
function parseArtifactZip(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<22||bytes.length>LIMITS.archiveBytes)fail('ARTIFACT_ARCHIVE_SIZE');
 function check(i,n){if(!Number.isSafeInteger(i)||i<0||i+n>bytes.length)fail('ARTIFACT_ZIP_TRUNCATED');}
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}}
 if(end<0)fail('ARTIFACT_ZIP_END');
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==count||count<1||count>LIMITS.entries||start+size!==end)fail('ARTIFACT_ZIP_DIRECTORY');
 let cursor=start,total=0,nextLocal=0;const names=new Set(),entries=[];
 for(let index=0;index<count;index++){
  check(cursor,46);if(bytes.readUInt32LE(cursor)!==0x02014b50)fail('ARTIFACT_ZIP_CENTRAL');
  const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),compressed=bytes.readUInt32LE(cursor+20),plain=bytes.readUInt32LE(cursor+24),nl=bytes.readUInt16LE(cursor+28),el=bytes.readUInt16LE(cursor+30),cl=bytes.readUInt16LE(cursor+32),attrs=bytes.readUInt32LE(cursor+38),offset=bytes.readUInt32LE(cursor+42);
  if(bytes.readUInt16LE(cursor+6)>20||flags&~0x0808||![0,8].includes(method)||bytes.readUInt16LE(cursor+34)||offset!==nextLocal)fail('ARTIFACT_ZIP_FEATURE');
  check(cursor+46,nl+el+cl);const rawName=bytes.subarray(cursor+46,cursor+46+nl),name=safePath(rawName),key=name.replace(/\/$/,'').toLowerCase();
  if(names.has(key)||[...names].some(n=>n.startsWith(key+'/')&&!name.endsWith('/')))fail('ARTIFACT_PATH_COLLISION');
  for(const ancestor of key.split('/').slice(0,-1).map((_,i)=>key.split('/').slice(0,i+1).join('/')))if(names.has(ancestor)&&entries.some(e=>e.path.toLowerCase()===ancestor))fail('ARTIFACT_PATH_COLLISION');
  names.add(key);extras(bytes.subarray(cursor+46+nl,cursor+46+nl+el));
  const type=(attrs>>>16)&0xf000;if(type!==0&&type!==0x8000&&type!==0x4000)fail('ARTIFACT_ZIP_SPECIAL_FILE');
  if((attrs&0x10)&&!name.endsWith('/')||type===0x4000&&!name.endsWith('/'))fail('ARTIFACT_ZIP_SPECIAL_FILE');
  if(plain>LIMITS.entryBytes||(total+=plain)>LIMITS.totalBytes||plain/Math.max(1,compressed)>LIMITS.ratio)fail('ARTIFACT_ZIP_BOMB');
  check(offset,30);if(bytes.readUInt32LE(offset)!==0x04034b50||bytes.readUInt16LE(offset+4)>20||bytes.readUInt16LE(offset+6)!==flags||bytes.readUInt16LE(offset+8)!==method)fail('ARTIFACT_ZIP_LOCAL');
  const lnl=bytes.readUInt16LE(offset+26),lel=bytes.readUInt16LE(offset+28),data=offset+30+lnl+lel;check(offset+30,lnl+lel);
  if(!rawName.equals(bytes.subarray(offset+30,offset+30+lnl)))fail('ARTIFACT_ZIP_NAME_MISMATCH');extras(bytes.subarray(offset+30+lnl,data));
  if(!(flags&8)&&(bytes.readUInt32LE(offset+14)!==crc||bytes.readUInt32LE(offset+18)!==compressed||bytes.readUInt32LE(offset+22)!==plain))fail('ARTIFACT_ZIP_SIZE_MISMATCH');
  check(data,compressed);nextLocal=data+compressed;if(nextLocal>start)fail('ARTIFACT_ZIP_OVERLAP');
  if(flags&8){check(nextLocal,12);if(bytes.readUInt32LE(nextLocal)===0x08074b50)nextLocal+=4;check(nextLocal,12);if(bytes.readUInt32LE(nextLocal)!==crc||bytes.readUInt32LE(nextLocal+4)!==compressed||bytes.readUInt32LE(nextLocal+8)!==plain)fail('ARTIFACT_ZIP_DESCRIPTOR');nextLocal+=12;}
  let output;try{if(method===0)output=bytes.subarray(data,data+compressed);else{const inflated=zlib.inflateRawSync(bytes.subarray(data,data+compressed),{maxOutputLength:Math.max(1,plain),info:true});if(inflated.engine.bytesWritten!==compressed)fail('ARTIFACT_ZIP_DEFLATE_TRAILING');output=inflated.buffer;}}catch{fail('ARTIFACT_ZIP_DECOMPRESSION');}
  if(output.length!==plain||crc32(output)!==crc)fail('ARTIFACT_ZIP_CRC');
  if(name.endsWith('/')){if(plain!==0)fail('ARTIFACT_ZIP_DIRECTORY_DATA');}else{if(output.includes(0))fail('ARTIFACT_TEXT_BINARY');entries.push({path:name,bytes:plain,content_sha256:hash(output),text:text(output)});}
  cursor+=46+nl+el+cl;
 }
 if(cursor!==end||nextLocal!==start||entries.length===0)fail('ARTIFACT_ZIP_LAYOUT');
 return {archive_sha256:hash(bytes),entries};
}
module.exports={parseArtifactZip,LIMITS,crc32,hash,fail};
