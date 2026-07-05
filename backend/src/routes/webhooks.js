const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { verifyWebhookSignature, handleWebhookEvent } = require('../services/github');

const router = express.Router();

router.post(
  '/github',
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-hub-signature-256'];
    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ error: 'Invalid webhook payload.' });
    }

    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload.' });
    }

    const event = req.headers['x-github-event'];
    const result = await handleWebhookEvent(event, payload);
    res.json(result);
  })
);

module.exports = router;
