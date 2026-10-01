/** Document load is not UI readiness: persisted state and plugin activation are asynchronous. */
export class FirstPresentation {
  private loaded = false;
  private ready = false;
  private scheduled = false;
  constructor(private readonly present: () => Promise<void>, private readonly failed: (error: unknown) => void) {}
  documentLoaded() { this.loaded = true; this.schedule(); }
  appearanceReady() { this.ready = true; this.schedule(); }
  private schedule() {
    if (!this.loaded || !this.ready || this.scheduled) return;
    this.scheduled = true;
    void this.present().catch(this.failed);
  }
}
