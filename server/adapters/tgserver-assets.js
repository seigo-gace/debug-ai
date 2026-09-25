"use strict";
const {createTgserverAdapter,redact}=require("./tgserver.js");
function createTgserverAssetAdapter({baseUrl=process.env.DEBUG_AI_TGSERVER_URL,projectId=process.env.DEBUG_AI_TGSERVER_LOG_PROJECT_ID,fetchImpl=globalThis.fetch,outboxDir,timeoutMs=10000,replayLimit=20}={}){if(!projectId)throw new Error("TGSERVER_PROJECT_ID_REQUIRED");const adapter=createTgserverAdapter({baseUrl,logProjectId:projectId,kbProjectId:projectId,fetchImpl,outboxDir,timeoutMs,replayLimit});return {endpoint:adapter.ingestEndpoint,projectId,outboxDir:adapter.outboxDir,emit:adapter.emit,promote:adapter.promote,flushOutbox:adapter.flushOutbox,redact};}
module.exports={createTgserverAssetAdapter,redact};
