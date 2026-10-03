export interface SessionRecoveryApi {
  /** Explicit user acknowledgement; never infer completion or replay a request. */
  endWait(sessionId:string,confirm:boolean):Promise<unknown>;
}
