import type { AppState, Project } from '../contracts';

/** A sidebar project for unassigned chats; their stored identity remains null. */
export const RECENT_PROJECT_ID = '__recent__';
export function recentProject(state: Pick<AppState, 'recentProject'>): Project {
  const saved = state.recentProject;
  return { id: RECENT_PROJECT_ID, name: saved?.name ?? '最近会话', path: saved?.paths?.[0] ?? '', paths: saved?.paths ?? [], pinned: saved?.pinned ?? false, authority: 'local', group: '' };
}
export const projectSessionId = (id: string): string | null => id === RECENT_PROJECT_ID ? null : id;
