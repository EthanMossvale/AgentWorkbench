import { assertVisualizationHtml, visualizationState } from './index';
export interface VisualizationPageOptions { html: string; channel: string; state: unknown; dark: boolean }
const json = (value: unknown) => JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
/** Host-created envelope. Content has an opaque origin and no Workbench bridge. */
export function visualizationDocument(options: VisualizationPageOptions) {
  assertVisualizationHtml(options.html);
  if (!/^[a-z0-9-]{16,80}$/i.test(options.channel) || typeof options.dark !== 'boolean') throw Error('VISUALIZATION_CHANNEL_INVALID');
  const state = visualizationState(options.state);
  return `<!doctype html><html lang="zh-CN" data-theme="${options.dark?'dark':'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root{color-scheme:light;--background:#faf9f6;--foreground:#292623;--card:#f2eee7;--card-foreground:var(--foreground);--popover:var(--background);--popover-foreground:var(--foreground);--primary:#37302b;--primary-foreground:#fffaf2;--secondary:#eee8df;--secondary-foreground:var(--foreground);--muted:#ece8e1;--muted-foreground:#746b62;--accent:#eee3d0;--accent-foreground:var(--foreground);--border:#d9d2c8;--input:var(--border);--ring:#916326;--blue:#426ea2;--orange:#a56829;--green:#47785d;--red:#b4514f;--purple:#8261a1;--yellow:#9e812e;--destructive:var(--red);--viz-series-1:var(--orange);--viz-series-2:var(--blue);--viz-series-3:var(--green);--viz-series-4:var(--purple);--viz-series-5:var(--red);--viz-series-6:var(--yellow);--font-size-base:14px}
  :root[data-theme=dark]{color-scheme:dark;--background:#242220;--foreground:#eee7df;--card:#302d29;--primary:#e7d6bb;--primary-foreground:#26221c;--secondary:#35312c;--muted:#35312c;--muted-foreground:#bdb1a4;--accent:#443a2c;--border:#50483f;--ring:#d9b678;--blue:#89b1e4;--orange:#e8b56f;--green:#8fbfa1;--red:#e58f8a;--purple:#bba0d8;--yellow:#d9c178}
  *{box-sizing:border-box}html,body{margin:0;background:var(--background);color:var(--foreground);font:var(--font-size-base)/1.5 system-ui,sans-serif}body{padding:16px;overflow-wrap:anywhere}button,input,select,textarea{font:inherit;color:inherit}button,select,input{accent-color:var(--primary)}button{cursor:pointer;border:1px solid var(--border);background:var(--card);border-radius:7px;padding:6px 12px}button[aria-pressed=true],button[aria-selected=true],.btn-primary{background:var(--primary);color:var(--primary-foreground)}svg,canvas,img{max-width:100%}.card{background:var(--card);color:var(--card-foreground);border-radius:12px;padding:16px}.text-small{font-size:.86em}.text-muted{color:var(--muted-foreground)}.tabular-nums{font-variant-numeric:tabular-nums}.flex{display:flex}.grid{display:grid}.gap-2{gap:8px}.gap-4{gap:16px}
  </style><script>
  (()=>{const channel=${json(options.channel)};let state=${json(state)},sequence=0,queue=Promise.resolve();const pending=new Map();
  const send=(type,data={})=>parent.postMessage({channel,type,...data},'*');
  const update=value=>{state=value;window.dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:{widgetState:state}}}));};
  const api=Object.freeze({get widgetState(){return structuredClone(state)},setWidgetState(value){const snapshot=structuredClone(value);const next=queue.then(()=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});send('state',{id,value:snapshot});}));queue=next.catch(()=>{});return next;}});
  Object.defineProperty(window,'openai',{value:api,writable:false,configurable:false});Object.defineProperty(window,'workbenchVisualization',{value:api,writable:false,configurable:false});
  window.addEventListener('message',event=>{const data=event.data;if(event.source!==parent||!data||data.channel!==channel)return;if(data.type==='globals'){document.documentElement.dataset.theme=data.dark?'dark':'light';update(data.state);}if(data.type==='state-result'){const call=pending.get(data.id);if(!call)return;pending.delete(data.id);clearTimeout(call.timer);if(data.error)call.reject(Error(data.error));else{update(data.state);call.resolve();}}});
  let scheduled=false,lastHeight=0;const measure=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;const height=Math.ceil(document.body.getBoundingClientRect().height);if(height!==lastHeight){lastHeight=height;send('height',{height});}})};
  window.addEventListener('DOMContentLoaded',()=>{new ResizeObserver(measure).observe(document.body);measure();send('ready')});
  window.addEventListener('error',()=>send('error'));window.addEventListener('unhandledrejection',()=>send('error'));
  document.addEventListener('click',event=>{const link=event.target.closest?.('a[href]');if(link&&!link.getAttribute('href').startsWith('#')){event.preventDefault();send('blocked-navigation');}},true);
  document.addEventListener('submit',event=>event.preventDefault(),true);
  })();</script></head><body>${options.html}</body></html>`;
}
