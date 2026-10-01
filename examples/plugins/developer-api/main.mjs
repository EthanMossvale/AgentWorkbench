export function activate(api) {
  let nativeLists = 0;
  api.services.register('example.developer', { version: 1 });
  api.services.intercept('native.cli', 'list', (next, ...args) => { nativeLists++; return next(...args); });
  api.registerMethod('example/developer/status', () => ({
    nativeLists,
    sessions: api.services.get('workbench.state').get().sessions.length,
    services: api.services.list().map(service => service.id),
  }));
  // Replaces the existing offline sample only; no model task or installation.
  api.registerMethod('demo.sample/get', () => ({input:'插件提供的离线示例',translated:'An offline sample supplied by a plugin.'}));
  api.registerCommand('notify', payload => { api.emit('notice', payload); return {sent:true}; });
  api.services.intercept('workbench.controller', 'nativePeerTools', (next, ...args) => {
    const base = next(...args);
    return {
      ...base,
      definitions: [...base.definitions, {name:'plugin_example_ping',description:'Return a local plugin readiness result. Does not start a task or access files.',inputSchema:{type:'object',properties:{},additionalProperties:false}}],
      call: async (name, input, signal) => name === 'plugin_example_ping' ? {ready:true} : base.call(name,input,signal),
    };
  });
}
