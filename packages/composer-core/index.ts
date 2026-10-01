import type { SkillInvocation } from '../native-skills/invocation';
export function skillPrompt(text:string,skills:readonly SkillInvocation[]=[]):string { return skills.length ? skills.map(skill=>(skill.runtime==='claude'?'/':String.fromCharCode(36))+skill.name).join(' ')+(text?' '+text:'') : text; }
export function skillBody(text:string,skills:readonly SkillInvocation[]=[]):string { const prefix=skillPrompt('',skills);return prefix&&text.startsWith(prefix+' ')?text.slice(prefix.length+1):prefix&&text===prefix?'':text; }
export { composerCommands, composerScopeKey, type ComposerCommand, type ComposerScope, type ComposerCapabilities } from './commands';
export function composerQuery(text: string, cursor: number) {
  const prefix=text.slice(0,cursor),match=/(?:^|\s)([/$])([^\s/$]*)$/.exec(prefix);
  return match?{start:cursor-match[2]!.length-1,end:cursor,query:match[2]!,skillsOnly:match[1]==='$'}:null;
}
export function matchesComposer(query:string,...values:string[]) {const q=query.normalize('NFKC').toLocaleLowerCase();return values.some(value=>value.normalize('NFKC').toLocaleLowerCase().includes(q));}
