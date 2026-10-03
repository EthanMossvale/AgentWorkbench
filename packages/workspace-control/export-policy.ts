/** Convenient presets; callers may choose any positive duration in seconds. */
export const workspaceExportDurations = Object.freeze([
  {seconds:3600,label:'1h'}, {seconds:21600,label:'6h'}, {seconds:43200,label:'12h'},
  {seconds:86400,label:'1day'}, {seconds:604800,label:'7day'},
]);
export function workspaceExportTtl(value:unknown=3600):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)throw Error('请输入正整数秒数作为有效期。');
  return value;
}
