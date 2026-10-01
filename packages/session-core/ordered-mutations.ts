/** Coalesce mutations with an optional bounded window; barriers and flush drain it immediately. */
export class OrderedMutations<T> {
  private tail: Promise<void> = Promise.resolve();
  private pending?: ((state: T) => void)[];
  private drains=new Set<()=>void>();
  constructor(private apply: (mutate: (state: T) => void) => Promise<unknown>,private windowMs=0) {}
  push(mutate: (state: T) => void): Promise<void> {
    if (this.pending) { this.pending.push(mutate); return this.tail; }
    const batch = [mutate]; this.pending = batch;
    let ready:Promise<void>|undefined;
    if(Number.isFinite(this.windowMs)&&this.windowMs>0)ready=new Promise(resolve=>{const drain=()=>{clearTimeout(timer);this.drains.delete(drain);resolve();};const timer=setTimeout(drain,Math.min(this.windowMs,100));this.drains.add(drain);});
    this.tail = this.tail.then(async () => {
      if(ready)await ready;
      if (this.pending === batch) this.pending = undefined;
      await this.apply(state => { for (const change of batch) change(state); });
    });
    return this.tail;
  }
  barrier(work: () => Promise<unknown>): Promise<void> {
    for(const drain of this.drains)drain();
    this.pending = undefined;
    this.tail = this.tail.then(work).then(() => {});
    return this.tail;
  }
  async flush(): Promise<void> { for(const drain of this.drains)drain();await this.tail; }
}
