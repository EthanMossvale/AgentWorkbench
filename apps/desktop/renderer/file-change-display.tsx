export function displayChangePath(path: string, cwd?: string, roots: string[] = []) {
  const normalize = (value: string) => value.replaceAll('\\','/').replace(/\/$/,'');
  const normalized = normalize(path), base = normalize(cwd ?? '');
  const same = (value: string, prefix: string) => /^[a-z]:/i.test(value) ? value.toLowerCase().startsWith(prefix.toLowerCase()+'/') : value.startsWith(prefix+'/');
  if (base && same(normalized,base)) return normalized.slice(base.length+1);
  const other = roots.map(normalize).sort((a,b) => b.length-a.length).find(folder => same(normalized,folder));
  return other ? other.split('/').at(-1)+'/'+normalized.slice(other.length+1) : normalized;
}
export function ChangeCounts({added,removed}:{added:number|null;removed:number|null}) {
  return <span className="change-counts">{added !== null && <span className="change-added">+{added}</span>}{removed !== null && <span className="change-removed">−{removed}</span>}{(added === null || removed === null) && <small>行数未提供</small>}</span>;
}
