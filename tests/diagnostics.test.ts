import test from 'node:test';
import assert from 'node:assert/strict';
import {safeError} from '../apps/desktop/host/controller';
import {redactDiagnostic,errorDiagnostics} from '../packages/diagnostics';

test('long errors and authorization explanations remain readable while credential values are redacted',()=>{
 const detail='Permission authorization failed because the current file belongs to another owner. '+ 'Useful path diagnostics. '.repeat(40);
 assert.equal(safeError(Error(detail)),detail);
 const text='Fetch failed: authorization: "Bearer fake-token"; x-api-key=fixture-secret, password="contains spaces"; retry manually.';
 const actual=redactDiagnostic(text);assert.match(actual,/Fetch failed/);assert.match(actual,/retry manually/);assert.doesNotMatch(actual,/fake-token|fixture-secret|contains spaces/);
 assert.match(redactDiagnostic('Connect https://user:password@example.invalid/path failed'),/Connect https:\/\/\[redacted\]@example.invalid\/path failed/);
 assert.equal(redactDiagnostic('Key: -----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\nDiagnostic'), 'Key: [private-key-redacted]\nDiagnostic');
});
test('cancellation and timeout do not incorrectly claim every operation is translation',()=>{
 assert.equal(safeError(new DOMException('File listing cancelled','AbortError')),'操作已取消。 File listing cancelled');
 assert.equal(safeError(new DOMException('SSH deadline reached','TimeoutError')),'操作超时。 SSH deadline reached');
 assert.equal(errorDiagnostics.format('An ordinary string error'),'An ordinary string error');
});
