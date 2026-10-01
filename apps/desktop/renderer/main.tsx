import {uiPreferences} from './ui-preferences';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startPluginRenderers } from './plugin-renderer';
import './styles.css';
import 'katex/dist/katex.min.css';
import './LightTheme.css';
import './WorkspaceChrome.css';
import { PluginBootBoundary, startBootHealth } from './PluginBootRecovery';

startBootHealth();
void uiPreferences.initialize(window.workbench).then(()=>{
 createRoot(document.getElementById('root')!).render(<React.StrictMode><PluginBootBoundary><App /></PluginBootBoundary></React.StrictMode>);
 startPluginRenderers(window.workbench, document.getElementById('root')!);
});
