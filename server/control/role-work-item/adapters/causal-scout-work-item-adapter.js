"use strict";
const {continueRoleWorkItem}=require("../adapter.js");
async function continueCausalScoutWorkItem(props){return continueRoleWorkItem({...props,role:"causal_scout"});}
module.exports={continueCausalScoutWorkItem};
