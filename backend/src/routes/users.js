const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAdmin } = require('../middleware/authorize');
const { validatePassword } = require('../lib/password');
const { ASSIGNABLE_VIEWS, isValidRole, normalizeViews } = require('../lib/permissions');
const users = require('../services/users');

const router = express.Router();

router.use(requireAdmin);

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,50}$/;

router.get('/', asyncHandler(async (_req, res) => {
  res.json(await users.listUsers());
}));

router.get('/views', (_req, res) => {
  res.json({ views: ASSIGNABLE_VIEWS });
});

router.post('/', asyncHandler(async (req, res) => {
  const { username, password, role, allowed_views, is_active } = req.body || {};

  if (!USERNAME_PATTERN.test(String(username ?? '').trim())) {
    return res.status(400).json({
      error: 'Username must be 3-50 characters and use only letters, numbers, dot, dash, or underscore.',
    });
  }

  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  if (!isValidRole(role)) {
    return res.status(400).json({ error: 'Role must be admin, editor, or viewer.' });
  }

  // Admins reach every tab by role, so an empty list is fine for them only.
  const views = role === 'admin' ? ASSIGNABLE_VIEWS : normalizeViews(allowed_views);
  if (views === null) {
    return res.status(400).json({ error: 'allowed_views must be a list of valid tab names.' });
  }

  if (await users.findByUsername(username)) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  try {
    const created = await users.createUser({
      username,
      password,
      role,
      allowedViews: views,
      isActive: is_active !== false,
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === '23505' || err.code === '23514') {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    throw err;
  }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const existing = await users.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });

  const { role, allowed_views, is_active, password } = req.body || {};
  const changes = {};

  if (role !== undefined) {
    if (!isValidRole(role)) {
      return res.status(400).json({ error: 'Role must be admin, editor, or viewer.' });
    }
    changes.role = role;
  }

  if (allowed_views !== undefined) {
    const views = normalizeViews(allowed_views);
    if (views === null) {
      return res.status(400).json({ error: 'allowed_views must be a list of valid tab names.' });
    }
    changes.allowedViews = views;
  }

  if (is_active !== undefined) {
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be true or false.' });
    }
    changes.isActive = is_active;
  }

  if (password !== undefined && password !== '') {
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
    changes.password = password;
  }

  if (!Object.keys(changes).length) {
    return res.status(400).json({ error: 'No changes supplied.' });
  }

  // Losing the last admin would leave the users tab unreachable from the UI, so
  // block the change that would cause it instead of relying on the env fallback.
  const losesAdmin =
    (changes.role !== undefined && changes.role !== 'admin') || changes.isActive === false;
  if (existing.role === 'admin' && existing.is_active && losesAdmin) {
    if ((await users.countActiveAdmins(existing.id)) === 0) {
      return res.status(409).json({
        error: 'This is the last active administrator. Promote another admin first.',
      });
    }
  }

  if (changes.role === 'admin') changes.allowedViews = ASSIGNABLE_VIEWS;

  res.json(await users.updateUser(req.params.id, changes));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await users.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });

  if (req.user.id && req.user.id === existing.id) {
    return res.status(409).json({ error: 'You cannot delete your own account.' });
  }

  if (
    existing.role === 'admin' &&
    existing.is_active &&
    (await users.countActiveAdmins(existing.id)) === 0
  ) {
    return res.status(409).json({
      error: 'This is the last active administrator. Promote another admin first.',
    });
  }

  await users.deleteUser(req.params.id);
  res.status(204).send();
}));

module.exports = router;
