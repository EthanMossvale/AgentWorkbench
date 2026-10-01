import { reasoningEfforts } from './reasoning-info';

const effortField = /reasoning[_ .-]?effort|output_config(?:[.\s_\[\]'"-]*effort)?|\beffort\b|思考档位|推理(?:档位|等级|强度)/i;
const rejection = /invalid|unsupported|not support|not allowed|must be|should be|expected|permitted|allowed|unknown|literal_error|enum|不支持|无效|必须|应为|允许/i;
const record = (value:unknown):Record<string,any> => value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
/** Read only effort-scoped validation details. Never retain raw upstream messages or input echoes. */
export function reasoningRejection(data:unknown):{rejected:boolean;declared:string[]} {
  const root=record(data),nodes:unknown[]=[root.error??root];
  if(root.detail!==undefined)nodes.push(root.detail);
  const allowed=new Set<string>();let rejected=false;
  for(let index=0;index<nodes.length&&index<32;index++){
    const value=nodes[index];if(Array.isArray(value)){nodes.push(...value.slice(0,20));continue;}
    const node=record(value);
    for(const key of ['error','detail','errors'])if(node[key]!==undefined)nodes.push(node[key]);
    const location=[node.param,node.path,...(Array.isArray(node.loc)?node.loc:[])].filter(v=>typeof v==='string').join('.');
    const message=[typeof value==='string'?value:undefined,node.message,node.msg,node.type,node.code].filter(v=>typeof v==='string').join(' ').slice(0,16000);
    // Generic body locations must not hide an explicitly named effort field.
    // A specific, different parameter remains authoritative over message text.
    const generic=!location||/^(?:body|request|input)(?:\.body)?$/.test(location);
    if(!effortField.test(generic?message:location))continue;
    const lists=[node.allowed_values,node.supported_values,node.allowed,node.enum,node.supported_efforts,record(node.ctx).permitted];
    for(const list of lists)if(Array.isArray(list))for(const effort of reasoningEfforts)if(list.includes(effort))allowed.add(effort);
    const expected=typeof record(node.ctx).expected==='string'?record(node.ctx).expected:'';
    const suffix=/\b(?:supported|allowed|permitted|valid)\s+(?:values|efforts)(?:\s+(?:are|is))?\s*:?\s*(.{1,512})|\b(?:must|should)\s+be\s*(.{1,512})|\bexpected\s+(?:one of\s+)?(.{1,512})|(?:支持|允许)(?:的)?(?:值|档位)(?:为|是)?[：:]?\s*(.{1,512})/i.exec(message);
    const declared=[expected,...(suffix?suffix.slice(1).filter(Boolean):[])].join(' ').slice(0,2048);
    for(const effort of reasoningEfforts)if(new RegExp(`(?:^|[\\s,'"\\x60\\[\\]、：:])${effort}(?=$|[\\s,'"\\x60\\[\\]、.])`).test(declared))allowed.add(effort);
    if(rejection.test(message)||allowed.size)rejected=true;
  }
  return {rejected,declared:reasoningEfforts.filter(effort=>allowed.has(effort))};
}
