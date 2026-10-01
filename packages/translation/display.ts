/** Display metadata stays separate from native source messages. */
export interface MessageTranslation {
  translation?: string;
  translationStatus?: 'pending' | 'complete' | 'failed' | 'off';
  translationError?: string;
  translationSource?: string;
}

export function clearTranslation(message: MessageTranslation) {
  delete message.translation;
  delete message.translationStatus;
  delete message.translationError;
  delete message.translationSource;
}

export function translationPlacement(layout: 'panel'|'inline'|undefined, occupied: boolean, child = false) {
  return layout === 'inline' || occupied || child ? 'inline' : 'panel';
}

/** Paired tracking is meaningful only while both reading panes are visible. */
export function translationTrackingEnabled(placement: 'panel'|'inline', panelVisible: boolean, compact = false) {
  return placement === 'panel' && panelVisible && !compact;
}
