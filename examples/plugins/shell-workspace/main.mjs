export function activate(api) {
  api.registerCommand('summary', async () => {
    const state = await api.call('state/get');
    return {projects: state.projects.length, sessions: state.sessions.length};
  });
}
