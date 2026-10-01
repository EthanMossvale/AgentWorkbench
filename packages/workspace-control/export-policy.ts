/** Fixed authorization policy, not an extensible display catalog. */
export const workspaceExportDurations = Object.freeze([
  {seconds:3600,label:'1h'}, {seconds:21600,label:'6h'}, {seconds:43200,label:'12h'},
  {seconds:86400,label:'1day'}, {seconds:604800,label:'7day'},
]);
export function workspaceExportTtl(value:unknown=3600):number {
  if(typeof value!=='number'||!workspaceExportDurations.some(option=>option.seconds===value))throw Error('请选择有效期：1h、6h、12h、1day 或 7day。');
  return value;
}
