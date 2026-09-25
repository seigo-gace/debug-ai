"use strict";
const test=require('node:test');const assert=require('node:assert/strict');const G=require('../debug-governance-core.js');
test('NOT_REPRODUCED cannot confirm runtime cause',()=>{assert.equal(G.canConfirmCause({repro_status:'NOT_REPRODUCED',cause_kind:'RUNTIME'}),false);});
test('confirmed cause guard rejects unsupported reproduction state',()=>{assert.throws(()=>G.assertConfirmedCause({confidence:'CONFIRMED',repro_status:'ENVIRONMENT_MISMATCH',cause_kind:'RUNTIME'}),/CONFIRMED_CAUSE_WITHOUT_REPRO_AUTHORITY/);});
test('command sanitization strips secret values and stores hash only',()=>{const x=G.sanitizeCommandDescriptor('curl -H "Authorization: Bearer abc" token=secret123');assert.equal(x.raw_saved,false);assert.ok(!x.descriptor.includes('secret123'));assert.match(x.hash,/^[a-f0-9]{64}$/);});
test('debug type classification is bounded to canonical enums',()=>{assert.deepEqual(G.classifyDebugTypes(['memory','functional','memory']),['MEMORY','FUNCTIONAL']);assert.throws(()=>G.classifyDebugTypes(['MAGIC']),/DEBUG_TYPE_INVALID/);});
test('production debug is observe-only',()=>{assert.equal(G.assertProductionObserveOnly({environment:'production',action:'observe'}),true);assert.throws(()=>G.assertProductionObserveOnly({environment:'production',action:'write'}),/PRODUCTION_WRITE_FORBIDDEN/);});
