const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { getOpsStatusDetailed } = require('../services/ops');

const router = express.Router();

router.get('/status', asyncHandler(async (_req, res) => {
  res.json(await getOpsStatusDetailed());
}));

module.exports = router;
