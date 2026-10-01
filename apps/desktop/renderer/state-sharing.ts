/** Retain equal JSON branches across IPC snapshots so presentation caches survive.
 * This is a renderer-owned copy; host state and extension payloads remain isolated. */
export function shareState<T>(previous:T,next:T):T {
  if(Object.is(previous,next))return previous;
  if(!previous||!next||typeof previous!=='object'||typeof next!=='object'||Array.isArray(previous)!==Array.isArray(next))return next;
  const before=previous as Record<string,unknown>,after=next as Record<string,unknown>;
  const keys=Object.keys(after);let equal=keys.length===Object.keys(before).length;
  for(const key of keys){const shared=shareState(before[key],after[key]);if(!Object.hasOwn(before,key)||shared!==before[key])equal=false;after[key]=shared;}
  return equal?previous:next;
}
