import express from 'express';

export function createRefreshRouter(trigger) {
  const r = express.Router();

  r.post('/', async (_req, res) => {
    const code = await trigger();
    res.json({ success: true, started: true, code });
  });

  return r;
}
