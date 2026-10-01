import {receiptCode, type MemoryReceiptCode} from '../../../packages/native-memory/receipts';

const labels:Record<MemoryReceiptCode,string>={
  MEMORY_RECEIPT_MISSING:'接收任务未提交落盘回执，档案仍待接收。',
  MEMORY_RECEIPT_INVALID:'回执格式或批次身份不匹配，档案仍待接收。',
  MEMORY_RECEIPT_ENTRY_MISSING:'部分档案尚未提交回执，已核验部分保留。',
  MEMORY_RECEIPT_ENTRY_INVALID:'回执的档案版本或来源范围不匹配。',
  MEMORY_RECEIPT_STORAGE_INVALID:'回执缺少有效的原生文件证据。',
  MEMORY_RECEIPT_FILE_INVALID:'回执指向的文件不是可核验的原生记忆。',
  MEMORY_RECEIPT_HASH_MISMATCH:'回执摘要与已保存文件不一致，需重新回读核验。',
  MEMORY_RECEIPT_ALREADY_PRESENT_MISMATCH:'整理或翻译后的内容被误报为「原文已存在」，需补充有来源标记的原生引用。',
  MEMORY_RECEIPT_CONTENT_PROVENANCE:'原生记忆正文缺少有效的内容或来源标记。',
  MEMORY_RECEIPT_INDEX_INVALID:'回执未提供有效的原生记忆索引。',
  MEMORY_RECEIPT_INDEX_UNREACHABLE:'原生索引未在可读取范围内链接到记忆文件。',
  MEMORY_RECEIPT_INDEX_PROVENANCE:'原生索引链接缺少来源标记，正文落盘尚不能计为接收完成。',
  MEMORY_RECEIPT_NATIVE_CHANGED:'文件在核验期间发生变化，已保留当前内容。',
  MEMORY_RECEIPT_SOURCE_CHANGED:'来源记忆已更新，旧批次不计为新版本已接收。',
  MEMORY_RECEIPT_VERIFICATION_FAILED:'原生落盘或索引证据尚未通过校验，档案仍待接收。',
};
export function memoryReceiptExplanation(code:MemoryReceiptCode){return labels[code]??labels.MEMORY_RECEIPT_VERIFICATION_FAILED;}
export function memoryReceiptError(message:string){return memoryReceiptExplanation(receiptCode(message));}
