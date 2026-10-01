export function activate(api) {
  const removeContext = api.onContext(({ runtime }) => `The active workbench runtime is ${runtime}.`);
  const removeCommand = api.registerCommand('describe', () => ({ id: api.id, apiVersion: api.version }));
  const removeMiddleware = api.useHost(async (request, next) => {
    if (request.method === 'personal/example') return { message: 'Handled by the example plugin.' };
    return next(request);
  });
  api.onDispose(() => { removeContext(); removeCommand(); removeMiddleware(); });
}
