import type {NativeEventCoverage,NativeEventPresentation} from './types';
import {record} from './catalog';

// Explicit public projections. Unknown payloads and authentication bodies never enter UI state.
const codex:Record<string,string>={
  'thread/status/changed':'原生会话活动状态已同步','thread/archived':'原生会话已归档','thread/deleted':'原生会话已删除','thread/unarchived':'原生会话已取消归档','thread/closed':'原生会话连接已关闭','thread/reverted':'原生会话已回退',
  'skills/changed':'原生技能目录已变更','thread/attachment/updated':'原生附件状态已变更','thread/goal/updated':'原生目标状态已更新','thread/goal/cleared':'原生目标已清除',
  'thread/queue/changed':'原生消息队列已变更','project/changed':'原生项目状态已变更','thread/project/updated':'原生项目关联已更新','thread/environment/connected':'原生执行环境已连接','thread/environment/disconnected':'原生执行环境已断开','thread/settings/updated':'原生会话设置已同步',
  'turn/diff/updated':'原生回合差异已更新（文件卡保留逐项变更）','mcpServer/oauthLogin/completed':'MCP 登录流程已返回','mcpServer/event/stream/notification':'MCP 服务通知已收到','account/updated':'原生账户信息变更通知','app/list/updated':'原生应用目录变更通知',
  'modelProvider/authRecoveryStarted':'原生认证恢复已开始','modelProvider/authRecoveryCompleted':'原生认证恢复已结束','windows/worldWritableWarning':'原生 Windows 文件权限提醒','windowsSandbox/setupCompleted':'原生 Windows 沙箱设置已返回','account/login/completed':'原生账户登录流程已返回',
};
export function knownNativePresentation(event:NativeEventCoverage,value:Readonly<Record<string,unknown>>):NativeEventPresentation|undefined{
  if(event.disposition!=='observed')return;
  if(event.runtime==='codex'&&event.key.startsWith('notification/')){
    const title=codex[event.key.slice('notification/'.length)];if(title){const p=record(value.params),status=typeof p.status==='string'?p.status:typeof record(p.status).type==='string'?record(p.status).type:undefined;return {title,...(status?{detail:'Native status: '+String(status).slice(0,160)}:{})};}
  }
  if(event.key.startsWith('content/'))return {title:({tool_reference:'原生工具引用已接收',image:'原生图像内容已接收',localImage:'本地图像引用已接收',inputImage:'图像输入已接收',document:'原生文档内容已接收',search_result:'原生搜索内容已接收',resource:'MCP 资源内容已接收',resource_link:'MCP 资源链接已接收'} as Record<string,string>)[event.key.slice(8)]??'原生结构化内容已接收',detail:'Media and structured results stay with their owning message or tool. Opaque payloads are not copied into diagnostics.'};
  const title:Record<string,string>={'message/auth_status':'原生认证进度已接收（认证正文不留存）','message/prompt_suggestion':'原生后续建议已接收（未自动发送）','message/active_goal':'原生目标通知已接收','system/thinking_tokens':'原生思考用量通知已接收','delta/citations_delta':'原生引用元数据已接收'};
  return title[event.key]?{title:title[event.key]!}:undefined;
}
