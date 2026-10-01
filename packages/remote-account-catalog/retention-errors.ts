const reasons:Record<string,string>={
 STORAGE_BUSY:'原生会话、登录或归档租约仍在使用；本轮暂不删除，稍后重新检查。',
 STORAGE_CHANGED:'归档期间远端原生文件发生变化；未继续删除，将重新核对文件。',
 STORAGE_NOT_DUE:'闲置时限已调整或模型重新活动，当前尚未到期；未继续删除。',
 STORAGE_DISABLED:'自动清理已关闭；已保存分块保留，未继续删除。',
 STORAGE_UNAVAILABLE:'远端归档服务未就绪或版本不支持此功能；请检查并更新工作台远端服务。',
 STORAGE_POLICY_UNSUPPORTED:'远端常驻服务尚不支持自定义闲置时限；已暂停清理，请更新远端工作台服务，不会按旧的 24 小时规则删除。',
 RESOURCE_BROKER_UNAVAILABLE:'无法连接远端统一账号服务；请检查服务状态后刷新。',
 STORAGE_DISK_PRESSURE:'远端可用空间低于保留余量，暂停恢复；本机归档仍保留。',
 STORAGE_RESTORE_CONFLICT:'远端原生文件与本机归档内容不同；未覆盖，请保留两份资料并核对。',
 STORAGE_ARCHIVE_CHANGED:'归档编号或清单发生变化；未继续删除，请核对对应设备的原生归档。',
 STORAGE_ACCOUNT_CHANGED:'远端账号身份或代次变化；未继续删除，请重新读取账号与会话列表。',
 STORAGE_SESSION_CHANGED:'远端会话归属变化；未继续删除，请刷新后核对。',
 STORAGE_LEASE_EXPIRED:'远端归档租约已过期；已保存分块保留，下轮重新取得租约。',
 STORAGE_UNSAFE_FILE:'原生目录内存在链接、异常所有权或不安全文件；已拒绝访问，请检查文件权限。',
 STORAGE_ARCHIVE_TOO_LARGE:'原生归档超出文件数量或大小上限；请检查该会话的历史及生成产物。',
 STORAGE_INVALID_NATIVE_METADATA:'无法识别原生历史元数据；为避免丢失上下文，未删除该组文件。',
 STORAGE_AMBIGUOUS_NATIVE_HISTORY:'同一原生线程对应多份不明确的历史；无法安全选择删除对象。',
 STORAGE_DEPENDENCY_MISSING:'原生历史依赖缺失；无法验证完整恢复，请核对该会话及分支文件。',
 STORAGE_OPERATION_UNCONFIRMED:'远端操作未返回可信回执；保留本机归档，下轮先核对远端再继续。',
 STORAGE_INVALID:'远端归档参数或服务协议不匹配；未继续操作，请核对两端服务版本。',
 LOCAL_ARCHIVE_MISSING:'远端已标记归档，但此设备没有对应完整副本；请接回保存归档的设备。',
 LOCAL_ARCHIVE_CORRUPT:'本机归档校验失败；完整副本损坏时禁止远端删除，未完成分块可重新下载。',
 LOCAL_DISK_PRESSURE:'本机空间不足或低于保留余量；未删除远端唯一副本，请先释放本机空间。',
 LOCAL_PERMISSION_DENIED:'本机归档或日志目录不可写；请检查目录权限和文件占用。',
 LOCAL_IO_ERROR:'本机磁盘读写失败；请检查磁盘状态，远端唯一副本保留。',
 SSH_FAILED:'SSH 连接未成功建立或已断开；请检查网络、主机身份及管理员密钥配置。',
 TIMEOUT:'本次 SSH 请求超时；已保存分块保留，稍后可以继续。',
 CANCELLED:'本次清理或恢复已取消；已保存分块保留，没有自动提交模型任务。',
 SPAWN_FAILED:'无法启动本机 OpenSSH；请检查 SSH 程序是否可用。',
 INVALID_HOST:'管理员 SSH 连接配置无效；请检查主机、端口和密钥路径。',
 OUTPUT_LIMIT:'远端回执超过传输上限；已停止接收，请检查服务版本与返回范围。',
 ADMIN_REQUIRED:'此操作需要该 VPS 的 root 管理员连接。',
};
export class RetentionError extends Error {
 constructor(readonly code:string){super(reasons[code]??`清理未完成，远端返回 ${/^[A-Z][A-Z_]{0,79}$/.test(code)?code:'未知错误'}；未获得安全删除确认，请检查服务状态。`);}
}
export function retentionFailure(error:unknown):{code:string;message:string} {
 if(error instanceof RetentionError)return {code:error.code,message:error.message};
 const e=error as {code?:string;name?:string;message?:string},text=e?.message??'';
 const code=e?.code==='ENOSPC'||e?.code==='EDQUOT'||text.includes('本机归档空间不足')?'LOCAL_DISK_PRESSURE':
  ['EACCES','EPERM','EBUSY'].includes(e?.code??'')?'LOCAL_PERMISSION_DENIED':e?.code==='EIO'?'LOCAL_IO_ERROR':
  text.includes('校验失败')?'LOCAL_ARCHIVE_CORRUPT':text.includes('本机完整归档缺失')?'LOCAL_ARCHIVE_MISSING':
  e?.name==='TimeoutError'?'TIMEOUT':e?.name==='AbortError'||text.includes('取消')||text.includes('暂停对应归档')?'CANCELLED':
  e?.code&&reasons[e.code]?e.code:'STORAGE_OPERATION_UNCONFIRMED';
 return {code,message:new RetentionError(code).message};
}
