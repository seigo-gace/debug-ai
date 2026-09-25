"use strict";
const crypto=require("node:crypto");
function stableStringify(value){if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(stableStringify).join(",")}]`;const keys=Object.keys(value).sort();return`{${keys.map(k=>`${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;}
function sha256(value){return crypto.createHash("sha256").update(typeof value==="string"?value:stableStringify(value)).digest("hex");}
module.exports={stableStringify,sha256};
