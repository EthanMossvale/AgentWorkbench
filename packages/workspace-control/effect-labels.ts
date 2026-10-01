/** Remote plans contain ASCII descriptors; all generated Chinese stays here. */
export function localizeControlEffect(value: string): string {
  if (!value.startsWith('awb-effect:')) return value;
  let data: Record<string, any>;
  try {data = JSON.parse(value.slice(11));} catch {throw Error('无效的管理变更预览。');}
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('无效的管理变更预览。');
  const labels: Record<string, string> = {
    'workspace.adopt': '登记已发现的系统用户和目录；保留 UID、文件、原生配置与既有 SSH 公钥。',
    'workspace.create': '显式创建一个新系统用户及 HOME；发现同名用户时要求纳入管理。',
    'workspace.update': '更新工作空间与账号配给；不安装 CLI，不变更原生登录。',
    'workspace.suspend': data.suspended === false ? '恢复空间访问，原设备继续使用原密钥，无需重新授权；已踢出的设备不会恢复。' : '暂停空间访问并保留设备授权，重新启用后自动恢复；尚未使用的导出文件失效。',
    'workspace.delete': '永久删除此空间的系统用户、整个用户目录和全部 SSH 授权；撤销账号使用权与邀请。',
    'device.revoke': '只移除此设备由本服务登记的精确公钥行；保留既有 SSH 公钥。',
    'invite.create': '签发一次性限时邀请；新设备自行生成私钥，仅提交公钥。',
    'invite.revoke': '撤销未使用邀请；已登记设备需单独撤销。',
    'quota.timing': '比例基于每个账号的完整额度窗口；比例修改立即重算当前窗口余额，保留已用额度和借款；超限开关立即生效。',
    'quota.service': '启用本工作台的 VPS 共享额度账本：仅 Unix socket，以 SSH 成员 UID 核实归属；不开放网络端口，不修改原有账号服务。',
    'account.none': '此空间未分配共享账号。',
  };
  if (labels[data.code]) return labels[data.code]!;
  if(data.code==='workspace.destroy'&&typeof data.home==='string'&&Number.isSafeInteger(data.storageBytes)&&data.storageBytes>=0)return `彻底删除目录：${data.home}；当前磁盘占用约 ${(data.storageBytes/1048576).toFixed(1)} MiB。共享 CLI 与集中登录账号保留。`;
  if (data.code === 'workspace.name' && typeof data.name === 'string') return '工作空间名称：' + data.name;
  if (data.code === 'workspace.member' && typeof data.username === 'string' && typeof data.root === 'string') return `成员：${data.username}；目录：${data.root}`;
  if (data.code === 'account.allow' && typeof data.accountId === 'string') return `允许账号：${data.accountId}；现有账号服务的使用权仍需在共享账号页核实。`;
  if (data.code === 'quota.allocate' && typeof data.accountId === 'string') {
    const percent = (v: unknown) => v === null ? '未配给' : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? `${v}%` : undefined;
    const weekly = percent(data.weeklyPercent), short = percent(data.fiveHourPercent);
    if (weekly === undefined || short === undefined || typeof data.allowOverage !== 'boolean') throw Error('无效的账号配给预览。');
    return `${data.accountId}：周额度 ${weekly}；${data.allowOverage ? '允许超限借用，刷新后按来源偿还' : '不允许超限借用'}。`;
  }
  throw Error('尚不支持此版本的管理变更预览，请更新工作台。');
}
