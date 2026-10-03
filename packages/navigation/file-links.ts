export interface FileReference { path: string; line?: number }
export interface LinkedText { text: string; reference?: FileReference; url?: string }
export interface FileReferenceRule { id:`plugin:${string}`; recognize(value:string):boolean|undefined }
export interface FileReferenceRecognitionApi {
  code(value:string):FileReference|undefined;
  register(rule:FileReferenceRule):()=>void;
  subscribe(listener:()=>void):()=>void;
  revision():number;
}
const referenceRules=new Map<string,FileReferenceRule>();
const referenceListeners=new Set<()=>void>();let referenceRevision=0;
const referenceChanged=()=>{referenceRevision++;for(const listener of referenceListeners)listener();};
export const fileReferenceRecognition:FileReferenceRecognitionApi={
  subscribe(listener){referenceListeners.add(listener);return ()=>{referenceListeners.delete(listener);};},
  revision:()=>referenceRevision,
  code(value){
    const reference=fileReference(value);if(!reference)return;
    for(const rule of [...referenceRules.values()].reverse()){
      const result=rule.recognize(value);
      if(result!==undefined)return result?reference:undefined;
    }
    return /[\\/]/.test(reference.path)?reference:undefined;
  },
  register(rule){
    if(!/^plugin:[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._-]*$/i.test(rule.id)||typeof rule.recognize!=='function')throw Error('FILE_REFERENCE_RULE_INVALID');
    if(referenceRules.has(rule.id))throw Error('FILE_REFERENCE_RULE_DUPLICATE');
    const entry={...rule};referenceRules.set(entry.id,entry);referenceChanged();
    return ()=>{if(referenceRules.get(entry.id)===entry){referenceRules.delete(entry.id);referenceChanged();}};
  }
};
export function isShortFileReference(value: string): boolean {
  return !!value && !/^(?:[a-z]:[\\/]|[\\/]|\.{1,2}[\\/]|~[\\/]|file:)/i.test(value);
}
export function webReference(value: string): string | undefined {
  if (!/^https?:\/\//i.test(value) || /[\x00-\x20\x7f]/.test(value)) return;
  try { const url = new URL(value); if (!url.hostname || url.username || url.password) return; return url.href; } catch { return; }
}
export function fileReference(value: string): FileReference | undefined {
  let target = value.trim().replace(/^<|>$/g, '');
  if (/^file:\/\//i.test(target)) { try { const url = new URL(target); if (url.hostname && url.hostname !== 'localhost' || url.username || url.password || url.port || url.search) return; target = decodeURIComponent(url.pathname).replace(/^\/(?=[a-z]:\/)/i, '') + (/^#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/.test(url.hash) ? url.hash : ''); } catch { return; } }
  // Native Markdown can use /C:/... destinations; normalize only one drive prefix.
  target = target.replace(/^\/(?=[a-z]:[\\/])/i, '');
  const suffix = target.match(/(?::(\d+)(?::\d+)?(?:-\d+(?::\d+)?)?|#L(\d+)(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/);
  const line = suffix ? Number(suffix[1] ?? suffix[2]) : undefined;
  if (suffix) target = target.slice(0, suffix.index);
  if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) return;
  if (!target || /[\x00-\x1f\x7f<>"|?*]/.test(target) || target.length > 4096 || /^(?:\\|\/\/)/.test(target)) return;
  // Code spans and explicit links can contain spaces, Unicode and ordinary filename punctuation.
  // Require a path separator, dotfile or extension so ordinary code identifiers remain text.
  if (!/^(?:[a-z]:[\\/]|\/|[~.]?[.][\\/]|~[\\/])/i.test(target) && !/^[\w.\-\u0080-\uffff @()+%#\[\]&{},=!'$]+(?:[\\/][\w.\-\u0080-\uffff @()+%#\[\]&{},=!'$]+)*[\\/]?$/.test(target)) return;
  if (!/[\\/]/.test(target) && !/^\.[\w-]+$/.test(target) && !/\.[a-z\d]{1,12}$/i.test(target)) return;
  if (target.replace(/^[a-z]:/i, '').includes(':')) return;
  return { path: target, ...(line && Number.isSafeInteger(line) ? { line } : {}) };
}
/** URL destinations decode once; literal code/file names never undergo URL decoding. */
export function fileLinkDestination(value: string): FileReference | undefined {
  if (/^file:\/\//i.test(value)) return fileReference(value);
  const hash = value.indexOf('#');
  if (hash >= 0 && !/^#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?$/.test(value.slice(hash))) value = value.slice(0, hash);
  try { return fileReference(decodeURIComponent(value.replace(/%(?![a-f\d]{2})/gi, '%25'))); } catch { return; }
}
export function fileMarkdownDestination(reference: FileReference): string {
  const value = /^[a-z]:[\\/]/i.test(reference.path) ? reference.path.replaceAll('\\', '/') : reference.path;
  return encodeURI(value).replaceAll('#', '%23') + (reference.line ? ':' + reference.line : '');
}
/** Display-only recognition; never parse HTML or turn fenced commands into links. */
export function linkedText(source: string): LinkedText[] {
  const result: LinkedText[] = [];
  const regex = /(?<![\w/\\:])(?:```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|\[([^\]\n]+)\]\(<?((?:[^()\n]|\([^()\n]*\))+)?>?\)|`([^`\n]+)`|"((?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/]|~[\\/])[^"\n]+)"|(?:https?:\/\/|file:\/\/\/)[^\s<>"`]+|[A-Za-z]:[\\/][^\s<>"`，。；！？、（）]+|(?:\.{1,2}[\\/]|~[\\/]|\/|[\w.\-\u0080-\uffff]+[\\/])[^\s<>"`，。；！？、（）]+?\.[a-z\d]{1,12}(?::\d+(?::\d+)?(?:-\d+(?::\d+)?)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)?(?=$|[\s.,;!，。；！、)\]}]))/gi;
  let cursor = 0;
  for (const match of source.matchAll(regex)) {
    if (/^(?:```|~~~)/.test(match[0])) continue;
    const explicit = match[2] ?? match[3] ?? match[4];
    let raw = explicit ?? match[0], trailing = '';
    if (explicit === undefined) {
      let trimmed = raw.replace(/[.,;!，。；！、]+$/, '');
      while (trimmed.endsWith(')') && (trimmed.match(/\)/g)?.length ?? 0) > (trimmed.match(/\(/g)?.length ?? 0)) trimmed = trimmed.slice(0,-1);
      trimmed = trimmed.replace(/[\]}]+$/, '');
      trailing = raw.slice(trimmed.length); raw = trimmed;
    }
    raw = raw.replace(/^<|>$/g, '');
    const url = webReference(raw), reference = url ? undefined : match[2] ? fileLinkDestination(raw) : match[3] ? fileReferenceRecognition.code(raw) : fileReference(raw);
    if (!url && !reference) continue;
    if (match.index! > cursor) result.push({ text: source.slice(cursor, match.index) });
    result.push({ text: match[1]?.replaceAll('`', '') ?? match[3] ?? match[4] ?? raw, ...(url ? { url } : { reference }) });
    if (trailing) result.push({ text: trailing });
    cursor = match.index! + match[0].length;
  }
  if (cursor < source.length) result.push({ text: source.slice(cursor) });
  return result;
}
