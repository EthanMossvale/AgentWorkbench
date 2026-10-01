/** An executable contract example, not a third-party model integration. */
export function activate(api) {
  const pending = new Map();
  api.runtimes.register({
    apiVersion: 1, id: 'plugin:example.echo', name: 'Echo 开发运行时', description: '离线回声；验证第三运行时插件接口，不调用模型。',
    permissions: [
      {value:'default',label:'默认',description:'此示例不执行文件或网络操作。'},
      {value:'read-only',label:'只读',description:'演示标准只读权限映射。'},
      {value:'plugin:review',label:'逐项复核',description:'演示插件自定义权限模式。'},
    ],
    models: ['echo','compact'].map((model,index)=>({id:model,model,name:index?'简短回声':'完整回声',isDefault:!index,efforts:[],serviceTiers:[]})),
  }, {
    async create() { return {turns:0}; },
    async run(ctx,input) {
      const source=input.translated, id=ctx.session().id;
      if(source.includes('[approval]')) {
        const accepted=new Promise(resolve=>pending.set(id,resolve));
        await ctx.emit({type:'approval',id:'confirm',kind:'tool',details:'Synthetic approval; no command will execute.',options:[{id:'allow',label:'允许示例',description:'只生成回声。',scope:'once'},{id:'deny',label:'拒绝',description:'结束本次示例。',scope:'deny'}]});
        const result=await accepted; if(ctx.signal.aborted)return;
        if(result!=='allow'){await ctx.emit({type:'message',id:'reply',text:'Example declined.',phase:'final'});return;}
      }
      const turns=(ctx.session().pluginRuntime.state?.turns??0)+1;
      await ctx.emit({type:'checkpoint',state:{turns}});
      await ctx.emit({type:'message',id:'reply',text:ctx.session().modelSelection?.model==='compact'?source.slice(0,40):`Echo ${turns}: ${source}`,phase:'final'});
    },
    async stop(ctx) { pending.get(ctx.session().id)?.('cancel'); pending.delete(ctx.session().id); },
    async approval(ctx,_id,reply) { pending.get(ctx.session().id)?.(reply.optionId);pending.delete(ctx.session().id); },
    async resume(ctx) { await ctx.emit({type:'message',id:'recovery',text:`Checkpoint recovered: ${ctx.session().pluginRuntime.state?.turns??0} completed turns. No input was replayed.`,phase:'final'}); },
    async fork(_source,destination) { return {turns:0,inheritedMessages:destination.messages.length}; },
    dispose() { for(const resolve of pending.values())resolve('cancel');pending.clear(); },
  });
}
