import {setTimeout as delay} from 'node:timers/promises';
import {runSsh,SshTransportError,type SshRunner,type SshRunOptions} from './index';
import type {SshHost} from '../contracts';
import {sshFailure} from './diagnostics';

/** Only fixed diagnostic text may cross the desktop boundary. */
export class SshReadError extends Error {
 constructor(readonly diagnostic:NonNullable<ReturnType<typeof sshFailure>>){super(diagnostic.message+' 诊断码：SSH_'+diagnostic.code);}
}

/** Explicit read-only metadata calls only. Never use for login, writes or model execution. */
export async function readOnlySsh(host:SshHost,command:string,options:SshRunOptions,runner:SshRunner=runSsh){
 const deadline=Date.now()+(options.timeoutMs??30_000);
 for(let attempt=0;attempt<2;attempt++){
  if(options.signal?.aborted)throw new SshReadError(sshFailure(undefined,new SshTransportError('CANCELLED','Cancelled'))!);
  try {
   const result=await runner(host,command,{...options,timeoutMs:Math.max(1,deadline-Date.now())});
   if(result.exitCode===0)return result;
   const failure=sshFailure(result)!;
   // A missing server banner proves this attempt sent no remote command.
   // Preserve the original deadline and never retry unknown post-command failures.
   if(attempt===0&&failure.code==='HANDSHAKE_TIMEOUT'&&deadline-Date.now()>500){
    try{await delay(250,undefined,{signal:options.signal});}catch{throw new SshReadError(sshFailure(undefined,new SshTransportError('CANCELLED','Cancelled'))!);}
    continue;
   }
   throw new SshReadError(failure);
  }catch(error){
   if(error instanceof SshReadError)throw error;
   const failure=sshFailure(undefined,error);if(failure)throw new SshReadError(failure);
   throw error;
  }
 }
 throw new Error('SSH_READ_UNCONFIRMED');
}
