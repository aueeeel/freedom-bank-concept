import type {Conversation} from './qa-model';

export const LAB_DIAGNOSTIC_SOURCE='Model Lab | diagnostics | 2026-11-08';
export const LAB_FULL_SOURCE='Model Lab | full | 2026-11-08';
export type DatasetId='all'|'lab'|'diagnostics'|'full'|'previous'|'drafts'|'upload';
export function inDataset(c:Conversation,id:DatasetId,uploadIds:ReadonlySet<string>=new Set()):boolean{
 const diagnostic=c.datasetSource===LAB_DIAGNOSTIC_SOURCE,full=c.datasetSource===LAB_FULL_SOURCE;
 return id==='all'||(id==='upload'&&uploadIds.has(c.id))||(id==='lab'&&(diagnostic||full))||(id==='diagnostics'&&diagnostic)||(id==='full'&&full)||(id==='previous'&&!!c.backendKey&&!diagnostic&&!full)||(id==='drafts'&&!c.backendKey);
}
export function datasetStats(cases:Conversation[]){
 return{dialogues:new Set(cases.map(c=>c.backendKey??c.id)).size,cards:cases.length,pending:cases.filter(c=>c.backendKey&&!c.backendVersion).length};
}
export function filterCases(cases:Conversation[],dataset:DatasetId,role:'all'|'bot'|'operator',query:string,uploadIds:ReadonlySet<string>=new Set()){
 const text=query.trim().toLocaleLowerCase();
 return cases.filter(c=>inDataset(c,dataset,uploadIds)&&(role==='all'||c.targetRole===role)&&(!text||`${c.sourceId??c.name} ${c.language}`.toLocaleLowerCase().includes(text)));
}
export function fileSummary(cases:Conversation[]){
 const rows=new Map<string,{key:string;name:string;bot?:Conversation;operator?:Conversation;draft?:Conversation}>();
 for(const c of cases){const key=c.backendKey??c.id;const row=rows.get(key)??{key,name:c.sourceId??c.name};if(c.targetRole)row[c.targetRole]=c;else row.draft=c;rows.set(key,row);}
 return [...rows.values()];
}
export function pendingBatch(cases:Conversation[]){
 const pending=cases.filter(c=>c.backendKey&&!c.backendVersion);
 return{keys:[...new Set(pending.map(c=>c.backendKey!))],count:pending.length};
}
