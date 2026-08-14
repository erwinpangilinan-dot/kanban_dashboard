const express = require('express');
const multer = require('multer');
const { asyncHandler } = require('../middleware/errorHandler');
const { memoriaFetch, recall } = require('../services/memoria-client');
const { ingestProcedure } = require('../services/mop-ingest');
const { extractMopDocument, MAX_BYTES } = require('../services/mop-extract');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

router.get('/graph', asyncHandler(async (req, res) => {
  try {
    const params = new URLSearchParams();
    for (const key of ['category', 'type', 'query', 'start_date', 'end_date', 'min_weight', 'limit']) {
      if (req.query[key]) params.set(key, String(req.query[key]));
    }
    const qs = params.toString() ? `?${params.toString()}` : '';
    const { data } = await memoriaFetch(`/graph${qs}`, { timeoutMs: 5000 });
    return res.json(data);
  } catch (err) {
    return res.json({
      node_count: 0,
      edge_count: 0,
      categories: ['Entity', 'Facts', 'Episodes', 'Entities', 'Daily'],
      nodes: [],
      edges: [],
      error: `Memoria service unavailable: ${err.message || 'Connection refused'}`,
    });
  }
}));

router.get('/recall', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  const limit = Math.min(Number(req.query.limit) || 8, 20);
  const { data } = await recall(q, limit);
  res.json({ query: q, results: Array.isArray(data) ? data : data?.results || data?.memories || data });
}));

router.post('/procedures', asyncHandler(async (req, res) => {
  const markdown = req.body?.markdown || req.body?.content;
  if (!markdown || !String(markdown).trim()) {
    return res.status(400).json({ error: 'markdown required' });
  }
  const result = await ingestProcedure({
    markdown: String(markdown),
    mop_id: req.body?.mop_id,
    title: req.body?.title,
    task_triggers: Array.isArray(req.body?.task_triggers)
      ? req.body.task_triggers
      : String(req.body?.task_triggers || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
    entities: Array.isArray(req.body?.entities)
      ? req.body.entities
      : String(req.body?.entities || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
  });
  res.status(201).json(result);
}));

/** Extract text from uploaded PDF / Word / markdown for review before ingest. */
router.post(
  '/procedures/extract',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    try {
      const extracted = await extractMopDocument(
        req.file.buffer,
        req.file.originalname || 'upload.bin',
        req.file.mimetype
      );
      res.json(extracted);
    } catch (err) {
      res.status(422).json({ error: err.message || 'Extraction failed' });
    }
  })
);

module.exports = router;
