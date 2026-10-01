export interface ConnectionPanePreference { navigationRatio: number; navigation: number; details: number }
export const defaultConnectionPanes: ConnectionPanePreference = {navigationRatio: .22, navigation: 180, details: 380};
export const paneGap = 16;
export const clampPane = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));
/** Width is the measured content area, not the application window. */
export function connectionPaneSizes(width: number, filesOpen: boolean, preferred: ConnectionPanePreference) {
  const stacked = width < 560, sideBySide = filesOpen && width >= 860;
  const navigation = Math.round(clampPane(filesOpen && sideBySide ? preferred.navigation : width * preferred.navigationRatio, 140, sideBySide ? width - 612 : Math.min(400, width - 316)));
  const details = sideBySide ? Math.round(clampPane(preferred.details, 300, width - navigation - 312)) : Math.max(0, width - navigation - paneGap);
  return {stacked, sideBySide, navigation, details, files: sideBySide ? width - navigation - details - paneGap * 2 : details};
}
