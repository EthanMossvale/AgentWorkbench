import test from 'node:test';
import assert from 'node:assert/strict';
import { changeDraftRoot, memberWorkspaceDirectory, renameDraftMember, memberUsernameError } from '../apps/desktop/renderer/studio-directories';

const draft = { username: 'alice', root: '/home/alice/workspaces', defaultDirectory: '/home/alice/workspaces' };

test('numeric input still previews directories and explains the member-name restriction',()=>{
 const value=renameDraftMember({username:'',root:'',defaultDirectory:''},'45451');
 assert.equal(value.root,'/home/45451/workspaces');assert.equal(value.defaultDirectory,value.root);
 assert.match(memberUsernameError(value.username),/小写字母/);
 assert.deepEqual(renameDraftMember(value,'user-45451'),{username:'user-45451',root:'/home/user-45451/workspaces',defaultDirectory:'/home/user-45451/workspaces'});
 assert.equal(memberUsernameError('user-45451'),'');assert.equal(memberUsernameError(''),'');
});

test('new workspace fields follow a valid member name and clear without an empty home segment', () => {
  const created = renameDraftMember({ username: '', root: '', defaultDirectory: '' }, 'alice');
  assert.deepEqual(created, draft);
  assert.deepEqual(renameDraftMember(created, 'beta'), { username: 'beta', root: '/home/beta/workspaces', defaultDirectory: '/home/beta/workspaces' });
  for (const username of ['', 'root', '../alice', 'alice/../../root', 'Alice', '空格', 'a'.repeat(33)]) {
    assert.equal(memberWorkspaceDirectory(username), '');
    assert.deepEqual(renameDraftMember(created, username), { username, root: '', defaultDirectory: '' });
  }
});

test('custom root and default directory each survive username edits independently', () => {
  assert.deepEqual(renameDraftMember({ ...draft, defaultDirectory: '/srv/writing' }, 'beta'), { username: 'beta', root: '/home/beta/workspaces', defaultDirectory: '/srv/writing' });
  assert.deepEqual(renameDraftMember({ ...draft, root: '/srv/workspaces' }, 'beta'), { username: 'beta', root: '/srv/workspaces', defaultDirectory: '/home/beta/workspaces' });
  assert.deepEqual(renameDraftMember({ username: '', root: '/srv/workspaces', defaultDirectory: '/srv/writing' }, 'beta'), { username: 'beta', root: '/srv/workspaces', defaultDirectory: '/srv/writing' });
});

test('root changes move only a following default directory and allow fields to resume auto-fill', () => {
  assert.equal(changeDraftRoot(draft, '/srv/alice').defaultDirectory, '/srv/alice');
  assert.equal(changeDraftRoot({ ...draft, defaultDirectory: '/srv/writing' }, '/srv/alice').defaultDirectory, '/srv/writing');
  const cleared = renameDraftMember(draft, '');
  assert.deepEqual(renameDraftMember(cleared, 'alice'), draft);
  assert.equal(renameDraftMember({ ...draft, defaultDirectory: '' }, 'beta').defaultDirectory, '/home/beta/workspaces');
});
