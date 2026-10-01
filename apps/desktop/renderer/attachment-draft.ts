export interface AttachmentDraftResult { added: number; duplicates: number }
type DraftTarget = (ids: string[]) => Promise<AttachmentDraftResult>;
let target: DraftTarget | undefined;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

/** Only the active composer registers a target; calls never submit a task. */
export const attachmentDraft = {
  available: () => !!target,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  register: (handler: DraftTarget) => {
    target = handler; emit();
    return () => { if (target === handler) { target = undefined; emit(); } };
  },
  add: async (ids: string[]): Promise<AttachmentDraftResult> => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 10 || ids.some(id => typeof id !== 'string' || !id)) throw Error('ATTACHMENT_DRAFT_IDS_INVALID');
    const handler = target;
    if (!handler) throw Error('ATTACHMENT_DRAFT_UNAVAILABLE');
    return handler([...new Set(ids)]);
  },
};

export const attachmentError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return ({
    ATTACHMENT_DRAFT_UNAVAILABLE: '当前没有可编辑的草稿，请先返回会话。',
    ATTACHMENT_DRAFT_BUSY: '正在处理附件，请稍后再试。',
    ATTACHMENT_DRAFT_CHANGED: '草稿已切换，未添加附件。',
    ATTACHMENT_DRAFT_IDS_INVALID: '附件选择无效，请重新选择。',
    ATTACHMENT_IMAGE_INVALID: '无法读取这张图片，请检查原文件。',
    ATTACHMENT_COPY_IMAGE_UNAVAILABLE: '当前环境暂不支持复制图片。',
  } as Record<string, string>)[message] ?? message;
};
