export interface QuotaWindow { usedPercent:number; windowMinutes?:number; resetsAt?:number }
export interface QuotaPool { id:string; name:string; primary?:QuotaWindow; secondary?:QuotaWindow; plan?:string; credits?:{unlimited:boolean; balance?:string} }
export interface ResetCard { key:string; type:string; count:number; available:boolean; creditId?:string; title?:string; expiresAt?:number }
export interface AccountUsage { ledger?:import('./ledger').QuotaLedgerView; ledgerReason?:string; accountId:string; observedAt:string; availability:'ready'|'unsupported'|'unavailable'; pools:QuotaPool[]; cards:ResetCard[]; cardsSupported:boolean; availableResetCount?:number; resetDetailsKnown?:boolean; reason?:string; pendingReset?:ResetReceipt }
export interface ResetPlan { id:string; accountId:string; cardType:string; remaining:number; expiresAt:string; creditId?:string; title?:string }
export interface ResetReceipt { id:string; accountId:string; cardType:string; state:'redeemed'|'denied'|'uncertain'; message:string }
