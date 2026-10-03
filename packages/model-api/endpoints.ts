import {normalizeBaseUrl} from '../translation/config';
export interface ApiEndpointRequest {baseUrl:string;resource:string;defaultVersion?:boolean}
export interface ApiEndpointResolver {id:`plugin:${string}`;resolve(request:ApiEndpointRequest):string|undefined}
export class ApiEndpoints {
 private resolvers=new Map<string,ApiEndpointResolver>();
 register(resolver:ApiEndpointResolver):()=>void{
  if(this.resolvers.has(resolver.id))throw Error('API_ENDPOINT_RESOLVER_DUPLICATE');
  const entry={...resolver};this.resolvers.set(entry.id,entry);return()=>{if(this.resolvers.get(entry.id)===entry)this.resolvers.delete(entry.id);};
 }
 resolve(request:ApiEndpointRequest):string{
  for(const resolver of [...this.resolvers.values()].reverse()){const result=resolver.resolve(request);if(result!==undefined)return result;}
  const url=new URL(normalizeBaseUrl(request.baseUrl,{defaultVersion:request.defaultVersion}));
  url.pathname=url.pathname.replace(/\/+$/,'')+'/'+request.resource;url.hash='';return url.href;
 }
}
export const apiEndpoints=new ApiEndpoints();
