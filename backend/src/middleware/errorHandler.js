function errorHandler(err, _req, res, _next) {
  console.error(err);

  if (err.code === '23505') {
    return res.status(409).json({ error: 'Resource already exists.' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced resource does not exist.' });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { errorHandler, asyncHandler };
