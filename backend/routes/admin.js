import express from 'express';
import fs from 'fs';
import path from 'path';

// Very light admin token guard
function adminGuard(req, res, next) {
  const required = process.env.ADMIN_TOKEN || 'dev-admin';
  const token = req.header('x-admin-token');
  if (!required) return next();
  if (token === required) return next();
  return res.status(401).json({ success: false, message: 'Unauthorized' });
}

export function createAdminRouter(api) {
  const r = express.Router();

  // list with optional pagination (server-side)
  r.get('/articles', adminGuard, (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10)));
    const list = api.getArticles();
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);
    res.json({ success: true, items, total: list.length, page, pageSize });
  });

  // create
  r.post('/articles', adminGuard, (req, res) => {
    try {
      const article = api.addArticle(req.body || {});
      res.status(201).json({ success: true, article });
    } catch (e) {
      res.status(400).json({ success: false, message: String(e?.message || e) });
    }
  });

  // update
  r.put('/articles/:id', adminGuard, (req, res) => {
    try {
      const id = Number(req.params.id);
      const updated = api.updateArticle(id, req.body || {});
      if (!updated) return res.status(404).json({ success: false, message: 'Not found' });
      res.json({ success: true, article: updated });
    } catch (e) {
      res.status(400).json({ success: false, message: String(e?.message || e) });
    }
  });

  // delete
  r.delete('/articles/:id(\\d+)', adminGuard, (req, res) => {
    const id = Number(req.params.id);
    const ok = api.deleteArticle(id);
    if (!ok) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true });
  });

  // media upload (base64 data URL)
  r.post('/upload', adminGuard, (req, res) => {
    try {
      const { filename, dataUrl } = req.body || {};
      if (!filename || !dataUrl) return res.status(400).json({ success: false, message: 'filename and dataUrl required' });
      const m = String(dataUrl).match(/^data:(.*?);base64,(.*)$/);
      if (!m) return res.status(400).json({ success: false, message: 'Invalid dataUrl' });
      const base64 = m[2];
      const buf = Buffer.from(base64, 'base64');
      const uploadsDir = path.join(api.getDataDir(), 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.join(uploadsDir, safeName);
      fs.writeFileSync(dest, buf);
      const publicUrl = `/uploads/${safeName}`;
      res.status(201).json({ success: true, url: publicUrl });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Upload failed', error: String(e?.message || e) });
    }
  });

  return r;
}
