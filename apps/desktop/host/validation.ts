import path from 'node:path';
import type { TranslationProfile } from '../../../packages/contracts/index';
import { normalizeBaseUrl, validateReasoning, validateTranslationProfile } from '../../../packages/translation/config';
export function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('无效请求。');return value as Record<string,unknown>;}
export function text(value:unknown,name:string,max=1000):string{if(typeof value!=='string'||value.length>max||value.includes('\0'))throw new Error(`${name}格式不正确。`);return value;}
export function required(value:unknown,name:string,max=1000):string{const result=text(value,name,max).trim();if(!result)throw new Error(`${name}不能为空。`);return result;}
export function flag(value:unknown,name:string):boolean{if(typeof value!=='boolean')throw new Error(`${name}必须是布尔值。`);return value;}
export function integer(value:unknown,min:number,max:number,name:string){if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)throw new Error(`${name}须在 ${min}–${max} 之间。`);return value;}
export function absolutePath(value:unknown){const result=required(value,'路径',4096);if(!path.isAbsolute(result)||/^[\\/]{2}[?.]/.test(result))throw new Error('请选择普通绝对路径，不接受设备路径。');return path.normalize(result);}
export function translationProfile(value:unknown):TranslationProfile{
 const p=object(value);const baseUrl=normalizeBaseUrl(required(p.baseUrl,'翻译端点',2048));
 const protocol=p.protocol;if(!['responses','chat-completions','anthropic-messages'].includes(String(protocol)))throw new Error('不支持的翻译协议。');
 if(p.effort)throw new Error('该模型的思考档位尚未实测，不会把请求值冒充已生效值。');
 const profile:TranslationProfile={id:'translation-default',name:required(p.name,'服务名称',100),baseUrl,protocol:protocol as TranslationProfile['protocol'],model:text(p.model,'模型',256).trim(),consent:flag(p.consent,'外发确认'),verifiedEfforts:[],maxCharacters:integer(p.maxCharacters,0,10000000,'字符上限'),maxCalls:integer(p.maxCalls,0,1000000,'调用预算'),timeoutMs:integer(p.timeoutMs,0,86400000,'等待上限')};
 if(p.source!==undefined){const source=object(p.source);if(source.kind==='custom')profile.source={kind:'custom',...(source.targetId?{targetId:required(source.targetId,'翻译模型',512)}:{}),...(source.effort?{effort:required(source.effort,'思考档位',32)}:{})};else if(source.kind==='model')profile.source={kind:'model',targetId:required(source.targetId,'翻译模型',512),...(source.effort!==undefined?{effort:required(source.effort,'思考档位',32)}:{})};else throw Error('TRANSLATION_SOURCE_INVALID');}
 if(p.revision!==undefined)profile.revision=required(p.revision,'翻译配置修订',100);
 if(p.maxOutputTokens!==undefined)profile.maxOutputTokens=integer(p.maxOutputTokens,256,128000,'最大输出 token');
 if(p.reasoning!==undefined){const r=object(p.reasoning);if(!['default','effort','adaptive','budget'].includes(String(r.mode)))throw new Error('不支持的思考模式。');profile.reasoning={mode:r.mode as NonNullable<TranslationProfile['reasoning']>['mode'],...(r.effort===undefined?{}:{effort:required(r.effort,'思考档位',32)}),...(r.budgetTokens===undefined?{}:{budgetTokens:integer(r.budgetTokens,1024,127999,'思考 token 预算')}),...(r.confirmed===undefined?{}:{confirmed:flag(r.confirmed,'思考参数确认')})};}
 profile.reasoning=validateReasoning(profile);
 return validateTranslationProfile(profile);
}
