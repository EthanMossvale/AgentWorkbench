"""Explicit account removal and remote browser login admission; no credential RPC."""
import copy
import re
import subprocess
import cli_guard


def dispatch(broker, uid, method, params):
    from broker import BrokerError
    if uid != 0:
        raise BrokerError('ADMIN_LOGIN_REQUIRED')
    common = {'authorityId', 'generation', 'accountId', 'accountGeneration'}
    extra = {'jobId'} if method != 'runtime/remove' else {'expectedRevision', 'confirm'}
    if method == 'runtime/login-release' and 'publish' in params:
        extra = extra | {'publish'}
        if type(params['publish']) is not bool:
            raise BrokerError('INVALID_REQUEST')
    if set(params) != common | extra:
        raise BrokerError('INVALID_REQUEST')
    runtime = broker.native_runtime()
    with broker.lock, runtime.lock, runtime.state.lock, broker.registry.lock:
        account = broker.registry.state['accounts'].get(params['accountId'])
        if not account or account['generation'] != params['accountGeneration']:
            raise BrokerError('ACCOUNT_UNAVAILABLE')
        job_id = params.get('jobId')
        if method != 'runtime/remove' and (account['provider'] != 'claude' or not isinstance(job_id, str) or not re.fullmatch(r'[a-f0-9-]{36}', job_id)):
            raise BrokerError('INVALID_REQUEST')
        if method == 'runtime/login-release':
            if broker.external_logins.get(account['id']) != job_id:
                raise BrokerError('JOB_UNAVAILABLE')
            if params.get('publish') is True and account.get('pendingLogin'):
                if account['status'] != 'authenticated':
                    raise BrokerError('ACCOUNT_UNAVAILABLE')
                candidate = copy.deepcopy(broker.registry.state)
                candidate['accounts'][account['id']].pop('pendingLogin', None)
                candidate['revision'] += 1
                broker.registry._commit(candidate)
            elif params.get('publish') is False and account.get('pendingLogin'):
                candidate = copy.deepcopy(broker.registry.state)
                del candidate['accounts'][account['id']]
                candidate['revision'] += 1
                broker.registry._commit(candidate)
            del broker.external_logins[account['id']]
            return {'released': True}
        if account['id'] in broker.external_logins:
            raise BrokerError('ACCOUNT_RUNTIME_BUSY')
        pending = list(runtime.active.values()) + list(runtime.state.state['sessions'].values())
        if any(v.get('accountId') == account['id'] and (v.get('stop') or any(v.get(k) for k in ('active', 'uncertain', 'rootPending', 'forkUncertain', 'forkAwaitingInput'))) for v in pending):
            raise BrokerError('ACCOUNT_RUNTIME_BUSY')
        if any(j['accountId'] == account['id'] and (j['value']['state'] in ('preparing', 'awaiting-code', 'verifying') or j['value']['cleanup'] != 'confirmed') for j in broker.jobs.values()):
            raise BrokerError('ACCOUNT_RUNTIME_BUSY')
        if method == 'runtime/login-reserve':
            broker.external_logins[account['id']] = job_id
            return {'reserved': True}
        if params['confirm'] is not True or params['expectedRevision'] != broker.registry.state['revision']:
            raise BrokerError('STALE_SELECTION')
        # Use official logout; never parse or directly delete credentials/history.
        env, profile = runtime.environment(account)
        binary = runtime.executable(account['provider'])
        with cli_guard.lease(account['provider'], binary):
            result = subprocess.run([binary] + (['auth', 'logout'] if account['provider'] == 'claude' else ['logout']), cwd=profile, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        if result.returncode:
            raise BrokerError('ACCOUNT_LOGOUT_UNCONFIRMED')
        candidate = copy.deepcopy(broker.registry.state)
        del candidate['accounts'][account['id']]
        for selection in candidate['selections'].values():
            if selection.get('accountId') == account['id']:
                selection.pop('accountId', None)
                selection['revision'] += 1
            if selection.get('claude', {}).get('accountId') == account['id']:
                selection['claude'] = {'revision': selection['claude']['revision'] + 1}
        candidate['revision'] += 1
        broker.registry._commit(candidate)
        return {'removed': account['id'], 'accountGeneration': account['generation']}
