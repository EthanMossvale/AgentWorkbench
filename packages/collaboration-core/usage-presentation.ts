/** Presentation of allowlisted native result counters, including saved JSON activities. */
export function usagePresentation(output: string | undefined): {label:string;value:string}[] {
  if (!output || output.length > 65536) return [];
  let data: Record<string, unknown>;
  try { data = JSON.parse(output); } catch { return []; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const fields = [
    ['durationMs', '运行耗时', 'duration'], ['apiDurationMs', 'API 耗时', 'duration'],
    ['turns', '模型调用', 'steps'], ['inputTokens', '未缓存输入', 'tokens'],
    ['outputTokens', '输出', 'tokens'], ['cacheReadTokens', '缓存读取', 'tokens'],
    ['cacheCreationTokens', '缓存写入', 'tokens'],
  ] as const;
  return fields.flatMap(([key,label,unit]) => {
    const n = data[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || (unit !== 'duration' && !Number.isSafeInteger(n))) return [];
    const seconds = Math.round(n / 100) / 10;
    const duration = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60 * 10) / 10} 秒`;
    return [{label,value:unit === 'duration' ? duration : `${n.toLocaleString('zh-CN')} ${unit === 'steps' ? '次' : 'tokens'}`}];
  });
}
