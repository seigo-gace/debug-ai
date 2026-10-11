"use strict";
const {continueRoleWorkItem}=require("../adapter.js");
async function continueCodeScoutWorkItem(props){return continueRoleWorkItem({...props,role:"code_scout"});}
module.exports={continueCodeScoutWorkItem};
