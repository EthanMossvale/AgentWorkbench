/** Public composer catalog contract. Opening a catalog never starts a model turn. */
export interface ComposerCommand {
  id: string; label: string; description: string; icon: string;
  action: 'attachments'|'files'|'skills'|'settings'|'status'|'plan'|'model'|'permissions'|'native';
  target?: string; source?: 'runtime'|'workbench'; runtime?: string; aliases?: string[]; disabledReason?: string;
}
export interface ComposerScope { runtime: string; sessionId?: string; directory?: string; targetId?: string }
export function composerScopeKey(scope: ComposerScope): string {
  return JSON.stringify([scope.sessionId??null,scope.runtime,scope.directory??'',scope.targetId??null]);
}
export interface ComposerCapabilities { compact?: boolean; compactDisabledReason?: string; model?: boolean; permissions?: boolean }
/** Only controls with a workbench execution/presentation path are advertised. */
export function composerCommands(runtime: string, capabilities: ComposerCapabilities = {}): ComposerCommand[] {
  const native=runtime==='codex'||runtime==='claude';
  const commands: ComposerCommand[] = native ? [
    {id:'compact',label:'压缩上下文',description:'由原生运行时总结历史，会消耗模型用量',icon:'document',action:'native',disabledReason:capabilities.compact?capabilities.compactDisabledReason:'当前执行连接尚未接入手动压缩'},
    {id:'model',label:'模型与思考深度',description:'打开当前运行时的模型设置',icon:'sparkle',action:'model'},
    {id:'permissions',label:'权限',description:'调整当前运行时的权限模式',icon:'settings',action:'permissions',aliases:runtime==='codex'?['approvals']:[]},
    {id:'plan',label:'计划模式',description:runtime==='codex'?'切换 Codex 计划协作模式，保留当前权限':'切换到 Claude Code 原生计划权限',icon:'sparkle',action:'plan'},
    {id:'context',label:'上下文用量',description:'查看当前模型容量与原生使用量',icon:'clock',action:'status'},
    {id:'skills',label:'技能',description:'选择当前运行时的原生技能',icon:'package',action:'skills'},
  ] : [
    ...(capabilities.model?[{id:'model',label:'模型',description:'打开当前运行时的模型设置',icon:'sparkle',action:'model' as const}]:[]),
    ...(capabilities.permissions?[{id:'permissions',label:'权限',description:'当前扩展运行时声明的权限',icon:'settings',action:'permissions' as const}]:[]),
  ];
  for(const command of commands){command.source='runtime';command.runtime=runtime;}
  return [...commands,...([
    {id:'attach',label:'文件和图片',description:'添加到本次消息',icon:'document',action:'attachments'},
    {id:'files',label:'工作区文件',description:'浏览当前目录',icon:'folder',action:'files'},
    {id:'status',label:'会话状态',description:'运行时、模型与上下文用量',icon:'clock',action:'status'},
    {id:'memory',label:'记忆',description:'原生记忆与交接进度',icon:'document',action:'settings',target:'memory'},
    {id:'plugins',label:'插件',description:'查看和管理已安装插件',icon:'package',action:'settings',target:'plugins'},
    {id:'connections',label:'连接',description:'管理工作空间连接',icon:'globe',action:'settings',target:'connections'},
    {id:'settings',label:'设置',description:'打开工作台设置',icon:'settings',action:'settings',target:'general'},
  ] satisfies ComposerCommand[]).map(command=>({...command,source:'workbench' as const}))];
}
