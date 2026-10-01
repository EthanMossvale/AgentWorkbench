import type {RemoteFileView} from '../../../packages/remote-account-catalog/resources';

export interface DirectoryCacheOptions {now?:()=>number; freshMs?:number; maxAgeMs?:number; maxEntries?:number; maxBytes?:number}
export type DirectoryListener = (path:string, view?:RemoteFileView, error?:unknown)=>void;
interface Job {path:string; background:boolean; generation:number; promise:Promise<RemoteFileView>; resolve:(view:RemoteFileView)=>void; reject:(error:unknown)=>void}
const key = (path:string) => path.replace(/\/+$/, '') || '/';
const ignored = /^\/(?:proc|sys|dev|run)(?:\/|$)/;
/** Per connection, directory metadata only. No persistent storage, file-content cache or recursive scans. */
export class RemoteDirectoryCache {
  private entries = new Map<string,{view:RemoteFileView; at:number; bytes:number}>();
  private jobs = new Map<string,Job>();
  private queue:Job[] = [];
  private listeners = new Set<DirectoryListener>();
  private bytes = 0;
  private generation = 0;
  private running = 0;
  private backgroundRunning = 0;
  private active = false;
  private disposed = false;
  private now:()=>number;
  constructor(private fetch:(path:string)=>Promise<RemoteFileView>, private options:DirectoryCacheOptions = {}) {
    for (const field of ['freshMs','maxAgeMs','maxEntries','maxBytes'] as const) if (options[field] !== undefined && (!Number.isSafeInteger(options[field]) || options[field]! < 1)) throw Error('REMOTE_DIRECTORY_CACHE_OPTIONS_INVALID');
    if ((options.freshMs ?? 30_000) > (options.maxAgeMs ?? 300_000)) throw Error('REMOTE_DIRECTORY_CACHE_OPTIONS_INVALID');
    this.now = options.now ?? Date.now;
  }
  subscribe = (listener:DirectoryListener) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  peek = (path:string) => {
    const target = key(path), item = this.entries.get(target);
    if (!item) return;
    if (this.now() - item.at > (this.options.maxAgeMs ?? 300_000)) {this.entries.delete(target); this.bytes -= item.bytes; return;}
    this.entries.delete(target); this.entries.set(target,item); return item.view;
  };
  setActive(active:boolean) {
    this.active = active;
    if (!active) this.dropQueued(()=>true);
    this.pump();
  }
  private emit(path:string, view?:RemoteFileView, error?:unknown) {if (!this.disposed) for (const listener of this.listeners) listener(path,view,error);}
  read = async (path:string):Promise<RemoteFileView> => {
    const target = key(path), cached = this.peek(target);
    if (cached) {
      if (this.now() - this.entries.get(target)!.at >= (this.options.freshMs ?? 30_000)) this.background(target);
      this.prefetchChildren(cached); return cached;
    }
    const view = await this.request(target,false);
    if (!this.disposed) this.prefetchChildren(view); return view;
  };
  /** Fetch current metadata for an operation; remote revisions remain the authority. */
  fresh = (path:string) => this.request(key(path),false);
  prefetch = (path:string) => {
    const target = key(path), cached = this.peek(target);
    if (!cached || this.now() - this.entries.get(target)!.at >= (this.options.freshMs ?? 30_000)) this.background(target);
  };
  private prefetchChildren(view:RemoteFileView) {
    if (view.kind !== 'directory') return;
    for (const entry of (view.entries ?? []).filter(entry=>entry.directory && !ignored.test(entry.path)).slice(0,6)) this.prefetch(entry.path);
  }
  private background(path:string) {
    if (!this.active || this.disposed || ignored.test(path) || this.queue.filter(job=>job.background).length >= 12) return;
    void this.request(path,true).catch(()=>{/* Visible consumers receive refresh failures through subscribe. */});
  }
  private request(path:string, background:boolean) {
    if (this.disposed) return Promise.reject(Error('REMOTE_DIRECTORY_CACHE_DISPOSED'));
    const existing = this.jobs.get(path);
    if (existing) {if (!background && this.queue.includes(existing)) {existing.background = false; this.pump();} return existing.promise;}
    if (this.queue.length >= 32) return Promise.reject(Error('REMOTE_DIRECTORY_CACHE_BUSY'));
    let resolve!:Job['resolve'], reject!:Job['reject'];
    const promise = new Promise<RemoteFileView>((yes,no)=>{resolve=yes; reject=no;});
    const job:Job = {path,background,generation:this.generation,promise,resolve,reject};
    this.jobs.set(path,job); this.queue.push(job); this.pump(); return promise;
  }
  private pump() {
    if (this.disposed) return;
    while (this.running < 2) {
      let index = this.queue.findIndex(job=>!job.background);
      if (index < 0 && this.active && this.backgroundRunning === 0) index = this.queue.findIndex(job=>job.background);
      if (index < 0) return;
      const job = this.queue.splice(index,1)[0]!;
      this.running++; if (job.background) this.backgroundRunning++;
      void this.execute(job);
    }
  }
  private async execute(job:Job) {
    try {
      const view = await this.fetch(job.path);
      if (this.disposed || job.generation !== this.generation) throw Error('REMOTE_DIRECTORY_CACHE_INVALIDATED');
      const prior = this.entries.get(job.path);
      if (prior) {this.entries.delete(job.path); this.bytes -= prior.bytes;}
      if (view.kind === 'directory') {
        const path = key(view.path), bytes = JSON.stringify(view).length * 2, old = this.entries.get(path);
        if (old) {this.entries.delete(path); this.bytes -= old.bytes;}
        if (bytes <= (this.options.maxBytes ?? 4 * 1024 * 1024)) {this.entries.set(path,{view,bytes,at:this.now()}); this.bytes += bytes;}
        while (this.entries.size > (this.options.maxEntries ?? 64) || this.bytes > (this.options.maxBytes ?? 4 * 1024 * 1024)) {
          const first = this.entries.entries().next().value;
          if (!first) break; this.entries.delete(first[0]); this.bytes -= first[1].bytes;
        }
      }
      this.emit(job.path,view); job.resolve(view);
    } catch(error) {
      if (!this.disposed && job.generation === this.generation) this.emit(job.path,undefined,error);
      job.reject(error);
    } finally {
      if (this.jobs.get(job.path) === job) this.jobs.delete(job.path);
      this.running--; if (job.background) this.backgroundRunning--; this.pump();
    }
  }
  private dropQueued(predicate:(job:Job)=>boolean) {
    this.queue = this.queue.filter(job=>{
      if (!predicate(job)) return true;
      if (this.jobs.get(job.path) === job) this.jobs.delete(job.path);
      job.reject(Error('REMOTE_DIRECTORY_CACHE_INVALIDATED')); return false;
    });
  }
  invalidate = () => {this.generation++; this.entries.clear(); this.bytes=0; this.dropQueued(()=>true); this.jobs.clear();};
  dispose() {this.disposed=true; this.invalidate(); this.listeners.clear();}
}
