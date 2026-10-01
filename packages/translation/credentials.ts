/** Translation accepts independent API credentials, never browser/CLI subscription sessions. */
export function assertIndependentTranslationKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(key)) {
    throw new Error('请使用独立翻译服务的 API Key；不要粘贴登录信息或认证文件。');
  }
  // Recognizable forms only: an arbitrary opaque string cannot prove its issuer or entitlement.
  if (/^sk-ant-(?:oat|ort|sid)/i.test(key)
    || /^(?:Bearer|Basic)\b/i.test(key)
    || /^(?:cookie|authorization|sessionKey|session[_-]?key|session[_-]?token|access_token|refresh_token|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_AUTH_TOKEN)[:=]/i.test(key)
    || /(?:^|;)sessionKey=/i.test(key)
    || /^(?:\{|\[)/.test(key)) {
    throw new Error('翻译模块不接受 Claude 登录令牌、Cookie 或认证文件；请使用独立 API Key。');
  }
}

export function assertTranslationApiHost(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (['claude.ai', 'claude.com'].some(domain => host === domain || host.endsWith('.' + domain))
    || ['anthropic.com', 'www.anthropic.com', 'console.anthropic.com', 'auth.anthropic.com'].includes(host)) {
    throw new Error('翻译模块不能连接 Claude 网页、登录或 Console 端点；请配置独立推理 API。');
  }
}
