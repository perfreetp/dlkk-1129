const express = require('express');
const { getDb } = require('../db/index');
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();

    const user = db.prepare(
      'SELECT id, username, avatar, bio FROM users WHERE id = ?'
    ).get(req.params.id);

    if (!user) {
      throw createError(404, 'Author not found');
    }

    const stats = db.prepare(
      `SELECT COUNT(*) AS software_count, COALESCE(AVG(avg_rating), 0) AS avg_rating, COALESCE(SUM(download_count), 0) AS total_downloads FROM software WHERE developer_id = ? AND status = 'approved'`
    ).get(req.params.id);

    res.json({ ...user, stats });
  })
);

router.get(
  '/:id/software',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const db = getDb();

    const total = db.prepare(
      `SELECT COUNT(*) AS total FROM software WHERE developer_id = ? AND status = 'approved'`
    ).get(req.params.id).total;

    const items = db.prepare(
      `SELECT * FROM software WHERE developer_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(req.params.id, limit, offset);

    res.json({ items, total, page, limit });
  })
);

router.get(
  '/:id/collections',
  asyncHandler(async (req, res) => {
    const db = getDb();

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
      throw createError(404, 'Author not found');
    }

    const collections = db.prepare(
      `SELECT c.*, COUNT(ci.id) AS item_count FROM collections c LEFT JOIN collection_items ci ON ci.collection_id = c.id WHERE c.curator_id = ? GROUP BY c.id ORDER BY c.created_at DESC`
    ).all(req.params.id);

    res.json(collections);
  })
);

module.exports = router;
