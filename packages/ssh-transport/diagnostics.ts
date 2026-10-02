import {SshTransportError,type SshResult} from './index';
/** Allowlisted desktop diagnostics; never return remote output or key/address values. */
export function sshFailure(result?:SshResult,error?:unknown):{code:string;message:string}|undefined{
 if(error instanceof SshTransportError){const messages={INVALID_HOST:'SSH 连接参数无效。',SPAWN_FAILED:'无法启动本机 OpenSSH 客户端。',CANCELLED:'SSH 请求已取消。',TIMEOUT:'SSH 请求超时，本次操作结果尚未确认。',OUTPUT_LIMIT:'SSH 返回内容超过限制。'};return {code:error.code,message:messages[error.code]};}
 const text=result?.stderr??'';
 const rules:[RegExp,string,string][]=[
  [/Could not resolve hostname|Name or service not known|No such host is known|Temporary failure in name resolution/i,'DNS','无法解析 SSH 主机名，请检查 DNS 和连接地址。'],
  [/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|No .* host key is known/i,'HOST_KEY','服务器身份与固定的主机密钥不匹配，请核实后重新导出工作空间文件。'],
  [/UNPROTECTED PRIVATE KEY FILE|bad permissions|Load key .*Permission denied|Identity file .*not accessible/i,'LOCAL_KEY','本机 SSH 密钥无法读取或权限不正确。'],
  [/timed out during banner exchange/i,'HANDSHAKE_TIMEOUT','SSH 握手超时，服务器尚未返回 SSH 标识；模型请求或设备登记尚未发送。'],
  [/Connection timed out|Operation timed out|No route to host|Network is unreachable/i,'NETWORK','无法连通 SSH 主机或端口，请检查网络和 SSH 服务。'],
  [/Connection refused/i,'REFUSED','SSH 端口拒绝连接，请检查服务器 SSH 服务。'],
  [/Connection reset|Connection closed|kex_exchange_identification|banner exchange/i,'CONNECTION_CLOSED','SSH 连接被关闭，请检查网络和服务器连接限制。'],
  [/Permission denied/i,'AUTH_REJECTED','服务器拒绝 SSH 身份，请核对账号和设备密钥。'],
 ];
 for(const [pattern,code,message] of rules)if(pattern.test(text))return {code,message};
 if(result&&result.exitCode!==0)return {code:'PROCESS_FAILED',message:'SSH 命令未成功完成，本次操作结果尚未确认。'};
}
