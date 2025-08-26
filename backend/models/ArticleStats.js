import fs from 'fs';
import path from 'path';

export default class ArticleStats {
  constructor({ persistDir }) {
    this.persistPath = path.join(persistDir, 'stats.json');
    this.data = { reads: {}, totals: { reads: 0, visitors: 0 } };
    try {
      if (fs.existsSync(this.persistPath)) {
        const raw = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
        if (raw && typeof raw === 'object') this.data = raw;
      }
    } catch {}
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify(this.data, null, 2));
    } catch {}
  }
  incrementRead(id) {
    const key = String(id);
    const entry = this.data.reads[key] || { count: 0, lastReadAt: null };
    entry.count += 1;
    entry.lastReadAt = new Date().toISOString();
    this.data.reads[key] = entry;
    this.data.totals.reads += 1;
    this.save();
    return entry;
  }
  popular(limit = 10) {
    const items = Object.entries(this.data.reads).map(([id, v]) => ({ id: Number(id), ...v }));
    return items.sort((a,b)=>b.count-a.count).slice(0, limit);
  }
  summary() {
    const online = this._estimateOnline();
    const articlesWithReads = Object.keys(this.data.reads).length;
    return {
      totals: this.data.totals,
      onlineUsers: online,
      articlesWithReads,
    };
  }
  _estimateOnline() {
    // naive estimation stub
    const minute = new Date().getMinutes();
    return (minute % 5) + 1;
  }
}
