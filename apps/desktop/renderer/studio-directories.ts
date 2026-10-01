interface DirectoryDraft { username: string; root: string; defaultDirectory: string }

export const memberWorkspaceDirectory = (username: string) =>
  /^[a-z0-9_][a-z0-9_-]{0,31}$/.test(username) && username !== 'root' ? `/home/${username}/workspaces` : '';

export const memberUsernameError = (username: string) => !username ? '' : username === 'root'
  ? '请使用普通成员用户名，不能使用 root。'
  : /^[a-z_][a-z0-9_-]{0,31}$/.test(username) ? ''
  : '用户名须以小写字母或下划线开头，限 32 位，可包含数字和连字符。例如 user-45451。';

/** Each generated field follows the member name independently of customized paths. */
export function renameDraftMember(draft: DirectoryDraft, username: string): DirectoryDraft {
  const previous = memberWorkspaceDirectory(draft.username), next = memberWorkspaceDirectory(username);
  const follow = (value: string) => !value || value === previous ? next : value;
  return { username, root: follow(draft.root), defaultDirectory: follow(draft.defaultDirectory) };
}

export function changeDraftRoot(draft: DirectoryDraft, root: string): DirectoryDraft {
  return { ...draft, root, defaultDirectory: !draft.defaultDirectory || draft.defaultDirectory === draft.root ? root : draft.defaultDirectory };
}
