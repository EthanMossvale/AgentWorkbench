const identifier=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function threadDeepLink(sessionId:string){if(!identifier.test(sessionId))throw new Error('Invalid local thread identifier.');return `agent-workbench://threads/${sessionId.toLowerCase()}`;}
export function parseThreadDeepLink(value:string):string|null{
 if(!/^agent-workbench:\/\/(?:threads|session)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))return null;
 try{const u=new URL(value);if(u.protocol!=='agent-workbench:'||!['threads','session'].includes(u.hostname)||u.username||u.password||u.port||u.search||u.hash)return null;const id=u.pathname.slice(1);return identifier.test(id)?id.toLowerCase():null;}catch{return null;}
}
