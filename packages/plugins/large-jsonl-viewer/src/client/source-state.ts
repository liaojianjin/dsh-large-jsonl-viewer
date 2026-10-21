/** Accept an explicit rebuild independently from unary/stream delivery order. */
import type { ViewSnapshot } from '../types.ts';
export class SourceState {
  private rebuilding?: { epoch: string; generation: number };
  private paused?: string;
  constructor(public version?: string) {}
  beginRebuild(snapshot: ViewSnapshot): void {
    this.rebuilding = { epoch: snapshot.epoch, generation: snapshot.generation };
  }
  cancelRebuild(): void {
    this.rebuilding = undefined;
  }
  observe(snapshot: ViewSnapshot): { changed: boolean; pause: boolean } {
    if (
      this.rebuilding?.epoch === snapshot.epoch &&
      snapshot.generation > this.rebuilding.generation
    ) {
      this.version = snapshot.version;
      this.rebuilding = undefined;
      this.paused = undefined;
    }
    if (this.version === undefined) this.version = snapshot.version;
    const changed = this.version !== snapshot.version || snapshot.progress.state === 'changed';
    const key = `${snapshot.epoch}:${snapshot.generation}:${snapshot.version}`;
    const pause = changed && snapshot.progress.state !== 'changed' && this.paused !== key;
    if (pause) this.paused = key;
    return { changed, pause };
  }
}
