'use strict';
const fs=require('node:fs');

const suites={
small:[
{id:'s01',file:'.debugai_codegen_benchmark/s01.py',spec:'Define select_latest_version(tags). tags contains strings in exact vN form where N is a nonnegative integer. Return None for empty input. Otherwise return the original tag with the greatest numeric N.'},
{id:'s02',file:'.debugai_codegen_benchmark/s02.py',spec:'Define clamp(value, low, high). Raise ValueError when low > high. Otherwise return value bounded inclusively to [low, high].'},
{id:'s03',file:'.debugai_codegen_benchmark/s03.py',spec:'Define dedupe_preserve(items). Return a new list with duplicates removed by normal Python equality while preserving the first occurrence order. Do not mutate input.'},
{id:'s04',file:'.debugai_codegen_benchmark/s04.py',spec:'Define safe_divide(a, b, default=None). If b == 0 return default, otherwise return a / b.'},
{id:'s05',file:'.debugai_codegen_benchmark/s05.py',spec:'Define normalize_email(value). Convert value to string, strip surrounding whitespace, and lowercase the entire result. Empty/whitespace-only input returns an empty string.'},
{id:'s06',file:'.debugai_codegen_benchmark/s06.py',spec:'Define parse_bool(value). bool inputs pass through. String inputs are stripped and case-insensitive: true/yes/1/on => True; false/no/0/off => False. All other inputs raise ValueError.'},
{id:'s07',file:'.debugai_codegen_benchmark/s07.py',spec:'Define chunks(items, size). size must be a positive integer or raise ValueError. Return a list of lists split in order into chunks of at most size. Do not mutate input.'},
{id:'s08',file:'.debugai_codegen_benchmark/s08.py',spec:'Define flatten_once(items). Flatten elements that are list or tuple by exactly one level; all other elements remain atomic. Return a new list.'},
{id:'s09',file:'.debugai_codegen_benchmark/s09.py',spec:'Define slugify_ascii(text). Convert to lowercase, treat every run of non-ASCII-alphanumeric characters as one hyphen, and trim leading/trailing hyphens.'},
{id:'s10',file:'.debugai_codegen_benchmark/s10.py',spec:'Define median(values). Raise ValueError on empty input. Return middle value for odd length and arithmetic mean of two middle values for even length. Do not mutate input.'}
],
medium:[
{id:'m01',file:'.debugai_codegen_benchmark/m01.py',spec:'Define merge_intervals(intervals). Each pair may be reversed and must be normalized. Return sorted [start,end] lists with overlapping or touching intervals merged. Empty input returns [].'},
{id:'m02',file:'.debugai_codegen_benchmark/m02.py',spec:'Define parse_duration(text). Accept only a full string made of optional integer hours then optional integer minutes then optional integer seconds, units h/m/s, at least one component, each unit at most once and in that order; surrounding whitespace allowed. Return total seconds. Malformed input raises ValueError.'},
{id:'m03',file:'.debugai_codegen_benchmark/m03.py',spec:'Define stable_top_k(items, k). Return up to k distinct values ordered by descending frequency; ties are broken by first occurrence in items. k <= 0 returns [].'},
{id:'m04',file:'.debugai_codegen_benchmark/m04.py',spec:'Define exponential_backoff(attempt, base=1.0, cap=60.0). attempt must be a nonnegative integer and base/cap must be nonnegative or raise ValueError. Return min(cap, base * 2**attempt).'},
{id:'m05',file:'.debugai_codegen_benchmark/m05.py',spec:'Define group_by(records, key). records is a list of dicts. Group records by record.get(key), preserving first-seen group order and record order. Return a dict. Do not mutate records.'},
{id:'m06',file:'.debugai_codegen_benchmark/m06.py',spec:'Define normalize_relpath(value). Interpret forward-slash POSIX relative paths. Reject absolute paths and any .. that would escape above root with ValueError. Collapse empty segments and .; resolve internal ..; return "." when normalized path is empty.'},
{id:'m07',file:'.debugai_codegen_benchmark/m07.py',spec:'Define sliding_window_allow(timestamps, now, limit, window). limit must be positive and window > 0 or raise ValueError. Count timestamps t satisfying now-window < t <= now. Return True iff count < limit. Input may be unordered and is not mutated.'},
{id:'m08',file:'.debugai_codegen_benchmark/m08.py',spec:'Define csv_escape(value). None becomes empty string. Other values use str(value). If the field contains comma, double quote, CR, or LF, surround with double quotes and double every internal double quote; otherwise return unchanged.'},
{id:'m09',file:'.debugai_codegen_benchmark/m09.py',spec:'Define rotate_matrix_clockwise(matrix). [] returns []. Non-empty matrix must be rectangular or raise ValueError. Return a new matrix rotated 90 degrees clockwise; do not mutate input.'},
{id:'m10',file:'.debugai_codegen_benchmark/m10.py',spec:'Define reconcile_by_id(old, new). Each is a list of dicts with unique id. Return {"added": [...], "removed": [...], "changed": [...]} where added follows new order, removed follows old order, and changed contains {"before":old_record,"after":new_record} in new order for same-id records whose full dict differs. Inputs unmodified.'}
],
hard:[
{id:'h01',file:'.debugai_codegen_benchmark/h01.py',spec:'Define topological_sort(graph). graph maps node strings to iterable dependency node strings. Include dependency-only nodes. Return a deterministic valid order using lexicographically smallest available node at each step. Raise ValueError on any cycle.'},
{id:'h02',file:'.debugai_codegen_benchmark/h02.py',spec:'Define deep_merge(base, override). Recursively merge dicts without mutating inputs. Scalars and lists in override replace base values. Exact string "__DELETE__" removes that key from the merged result. Nested deletions apply recursively.'},
{id:'h03',file:'.debugai_codegen_benchmark/h03.py',spec:'Define dedupe_events(events). Each event dict has id and timestamp plus arbitrary fields. Keep one event per id: greatest timestamp wins; if timestamps tie, later input wins. Return winning event dicts sorted by timestamp ascending then id string. Do not mutate inputs.'},
{id:'h04',file:'.debugai_codegen_benchmark/h04.py',spec:'Define apply_inventory(stock, operations). stock maps item to nonnegative integer quantity. operations is ordered dicts {"item":..., "delta":integer}. Apply atomically to a copy. If any intermediate quantity would be negative, raise ValueError and do not mutate stock. New items start at 0. Return the new dict.'},
{id:'h05',file:'.debugai_codegen_benchmark/h05.py',spec:'Define evaluate_access(rules, subject, action). Each rule has effect "allow" or "deny", subjects list, actions list; "*" matches anything. Matching deny overrides every allow. If no matching deny but at least one matching allow return True; otherwise False. Invalid effect raises ValueError.'},
{id:'h06',file:'.debugai_codegen_benchmark/h06.py',spec:'Define run_state_machine(events, max_retries). max_retries is nonnegative integer. Start state NEW, retry_count 0. START: NEW->RUNNING. SUCCESS: RUNNING->COMPLETE. FAIL: RUNNING increments retry_count; if retry_count <= max_retries -> RETRY_WAIT else -> FAILED. RETRY: RETRY_WAIT->RUNNING. Any invalid event for current state raises ValueError. Return {"state":state,"retry_count":count}.'},
{id:'h07',file:'.debugai_codegen_benchmark/h07.py',spec:'Define majority_value(replicas). replicas is a non-empty list of hashable values. Return a value only when it appears strictly more than half the list. Otherwise raise ValueError. Ties have no majority.'},
{id:'h08',file:'.debugai_codegen_benchmark/h08.py',spec:'Define allocate_tasks(tasks, workers). tasks are dicts {"id":str,"priority":number,"cost":positive number}; workers are {"id":str,"capacity":nonnegative number}. Process tasks by priority descending then task id ascending. For each task choose among workers with enough remaining capacity the worker with greatest remaining capacity, tie worker id ascending. Deduct cost. Return {"assignments":{task_id:worker_id}, "unassigned":[task_ids]} with unassigned in processing order. Inputs unmodified.'},
{id:'h09',file:'.debugai_codegen_benchmark/h09.py',spec:'Define aggregate_windows(events, window). window must be >0 or raise ValueError. Each event is {"ts":number,"value":number}; input may be unordered. Use tumbling windows start=floor(ts/window)*window. Return sorted list of {"start":start,"end":start+window,"sum":sum,"count":count}. Inputs unmodified.'},
{id:'h10',file:'.debugai_codegen_benchmark/h10.py',spec:'Define reconcile_replica_maps(replicas). replicas is a non-empty list of dicts. For every key in the union, treat a missing key as a distinct MISSING vote. A value or MISSING resolves only with strict majority (> n/2). Majority MISSING omits the key. No majority puts key in conflicts. Return {"resolved":dict,"conflicts":[sorted keys]}. Values are hashable. Inputs unmodified.'}
]};

function getCase(level,id){
 const cases=suites[level]; if(!cases) throw new Error('INVALID_LEVEL');
 const item=cases.find(x=>x.id===id); if(!item) throw new Error('INVALID_CASE');
 return item;
}
function buildCase(level,id,out){
 const item=getCase(level,id);
 const task=`Code generation benchmark case=${id} level=${level}. Produce exactly one patch candidate that creates only FILE ${item.file}. Implement exactly this specification: ${item.spec} Do not create tests, docs, helpers outside this file, or modify any existing file. Candidate only; never apply/publish/deploy.`;
 const diagnosis={cause_kind:'SYNTHETIC_CODEGEN_BENCHMARK',public_statement:`Implement case ${id} exactly as written.`,case:{id:item.id,file:item.file,spec:item.spec}};
 fs.writeFileSync(out,JSON.stringify({level,id,task,diagnosis,selected_paths:[item.file],case:item},null,2));
}
function validateCase(level,id,candidatePath,out){
 const item=getCase(level,id);
 const response=JSON.parse(fs.readFileSync(candidatePath,'utf8'));
 const candidate=response.candidate||{};
 const ops=Array.isArray(candidate.operations)?candidate.operations:[];
 let scope=ops.length===1;
 let material='';
 if(scope){
   const op=ops[0],p=String(op.path||'');
   scope=p===item.file&&['create','write'].includes(String(op.type||''));
   material=String(op.content||'');
 }
 fs.writeFileSync(out,JSON.stringify({level,id,scope_pass:scope,candidate_id:candidate.id||null,diff_hash:candidate.diff_hash||null,file:item.file,material},null,2));
 if(!scope) process.exitCode=3;
}
const [mode,level,id,a,b]=process.argv.slice(2);
if(mode==='build-case')buildCase(level,id,a);
else if(mode==='validate-case')validateCase(level,id,a,b);
else throw new Error('USAGE');
module.exports={suites,getCase};
