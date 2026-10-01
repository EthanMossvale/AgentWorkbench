import type { GeneratedImageDelivery } from '../../../packages/generated-images/types';
import { AttachmentList } from './Attachments';

const errors: Record<string, string> = {
  GENERATED_IMAGE_SIZE_LIMIT: '图片超过 20 MB，未自动保存。',
  GENERATED_IMAGE_ENCODING_INVALID: '图片结果编码无效，未保存。',
  GENERATED_IMAGE_FORMAT_INVALID: '图片结果不是支持的 PNG 文件。',
  GENERATED_IMAGE_WORKSPACE_INVALID: '当前工作区不能保存图片。',
  GENERATED_IMAGE_FILE_CHANGED: '目标文件已变化，未覆盖。',
  GENERATED_IMAGE_DIRECTORY_CHANGED: '目标目录已变化，已停止保存。',
  GENERATED_IMAGE_DELIVERY_INTERRUPTED: '上次图片接收中断，保存状态未确认。',
};
export default function GeneratedImageResult({ delivery }: { delivery: GeneratedImageDelivery }) {
  return <div className="generated-image-result" data-testid="generated-image-result" data-delivery-status={delivery.status}>
    {delivery.status === 'receiving' && <p role="status">正在保存到本地工作区…</p>}
    {delivery.status === 'failed' && <p role="alert">{errors[delivery.error ?? ''] ?? '图片未能保存到本地工作区。'}{delivery.remoteCopy === 'retained' ? '远端原图未清理。' : ''}</p>}
    {delivery.attachment && <><AttachmentList items={[delivery.attachment]}/><p className="generated-image-location">已保存到工作区 · {delivery.attachment.path}</p></>}
    {delivery.remoteCopy === 'pending' && <p role="status">本地文件已核验，正在清理远端 PNG…</p>}
    {delivery.status === 'saved' && delivery.remoteCopy === 'retained' && <p role="alert">本地图片已保存；远端 PNG 清理未确认。</p>}
    {delivery.remoteCopy === 'removed' && <small>远端 PNG 已清理；原生会话历史保留。</small>}
  </div>;
}
