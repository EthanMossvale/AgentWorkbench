import generated from './generated.json';
import type {BrandingSnapshot} from './types';

export const defaultBranding: Readonly<BrandingSnapshot> = Object.freeze({
  id:'workbench.connected-w',label:'Agent Workbench',revision:0,
  app:generated.images['256'],tray:Object.freeze({...generated.images}),
});
