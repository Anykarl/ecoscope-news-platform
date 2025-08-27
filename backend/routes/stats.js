import express from 'express';

export function createStatsRouter(statsModel, api) {
  const r = express.Router();

  // increment read count for an article
  r.post('/read/:id(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid id' });
    const article = api.findArticle(id);
    if (!article) return res.status(404).json({ success: false, message: 'Not found' });
    const entry = statsModel.incrementRead(id);
    res.json({ success: true, id, stats: entry });
  });

  r.get('/popular', (_req, res) => {
    const list = statsModel.popular(10);
    res.json({ success: true, items: list });
  });

  r.get('/summary', (_req, res) => {
    res.json({ success: true, ...statsModel.summary() });
  });

  return r;
}
