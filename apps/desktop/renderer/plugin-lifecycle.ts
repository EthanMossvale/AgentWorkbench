export type PluginCleanup = () => void | Promise<void>;
export type PluginContentResult = void | PluginCleanup;
export interface PluginContentContext { root: HTMLElement; signal: AbortSignal }

/** The callback may resolve after navigation or disable; its cleanup still runs. */
export function mountPluginContent<T extends PluginContentContext>(context: Omit<T, 'signal'>, render: (context: T) => PluginContentResult | Promise<PluginContentResult>, failed: (error: unknown) => void) {
  const abort = new AbortController();
  let cleanup: PluginCleanup | undefined;
  const clean = (fn?: PluginCleanup) => { try { void Promise.resolve(fn?.()).catch(() => {}); } catch { /* Release the remaining resources. */ } };
  queueMicrotask(() => {
    if (abort.signal.aborted) return;
    void Promise.resolve().then(() => abort.signal.aborted ? undefined : render({...context, signal: abort.signal} as T)).then(result => {
      if (typeof result === 'function') { if (abort.signal.aborted) clean(result); else cleanup = result; }
    }).catch(error => { if (!abort.signal.aborted) failed(error); });
  });
  return () => { if (abort.signal.aborted) return; abort.abort(); clean(cleanup); cleanup = undefined; context.root.replaceChildren(); };
}
