// 同じ馬が複数のレースに同時登録されるのを防ぐ（プロセス内の全ルーム共通）。
// ※ サーバーを複数台に分ける場合は Redis 等の共有ストアに置き換える必要がある。
export class EntryRegistry {
  private map = new Map<string, string>(); // horseId -> raceId

  tryAcquire(horseId: string, raceId: string): boolean {
    const cur = this.map.get(horseId);
    if (cur && cur !== raceId) return false;
    this.map.set(horseId, raceId);
    return true;
  }

  release(horseId: string, raceId: string): void {
    if (this.map.get(horseId) === raceId) this.map.delete(horseId);
  }

  holder(horseId: string): string | undefined {
    return this.map.get(horseId);
  }
}

export const globalEntryRegistry = new EntryRegistry();
