export interface RecoveryPresentationGate {
  consumeAutomatic(): boolean;
  markExplicit(): void;
  markDismissed(): void;
}

/** Coalesces automatic recovery notices without limiting explicit user requests. */
export function createRecoveryPresentationGate(): RecoveryPresentationGate {
  let automaticConsumed = false;
  let dismissed = false;
  return {
    consumeAutomatic() {
      if (automaticConsumed || dismissed) return false;
      automaticConsumed = true;
      return true;
    },
    markExplicit() {
      automaticConsumed = true;
    },
    markDismissed() {
      dismissed = true;
    },
  };
}
