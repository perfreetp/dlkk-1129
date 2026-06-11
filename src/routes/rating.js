const express = require('express');
const getDb = require('../db/index').getDb;
const { auth } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

function recalcAvgRating(db, softwareId) {
  const row = db.prepare(
    'SELECT AVG(rating) AS avg FROM reviews WHERE software_id = ?'
  ).get(softwareId);
  const avg = row.avg !== null ? Math.round(row.avg * 10) / 10 : 0;
  db.prepare(
    "UPDATE software SET avg_rating = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(avg, softwareId);
}

router.post(
  '/:softwareId/reviews',
  auth,
  asyncHandler(async (req, res) => {
    const { rating, content } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      throw createError(400, 'rating must be between 1 and 5');
    }

    const db = getDb();
    const software = db.prepare('SELECT id FROM software WHERE id = ?').get(req.params.softwareId);
    if (!software) throw createError(404, 'Software not found');

    const result = db.prepare(
      "INSERT INTO reviews (software_id, user_id, rating, content) VALUES (?, ?, ?, ?)"
    ).run(Number(req.params.softwareId), req.user.id, rating, content || '');

    recalcAvgRating(db, Number(req.params.softwareId));

    res.status(201).json({ id: result.lastInsertRowid, rating, content: content || '' });
  })
);

router.get(
  '/:softwareId/reviews',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { page: pageStr = '1', limit: limitStr = '20' } = req.query;
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const limit = Math.max(1, parseInt(limitStr, 10) || 20);
    const offset = (page - 1) * limit;

    const total = db.prepare(
      'SELECT COUNT(*) AS total FROM reviews WHERE software_id = ?'
    ).get(req.params.softwareId).total;

    const items = db.prepare(
      `SELECT r.*, u.username, u.avatar FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.software_id = ? ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
    ).all(req.params.softwareId, limit, offset);

    res.json({ items, total, page, limit });
  })
);

router.put(
  '/:softwareId/reviews/:id',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const review = db.prepare(
      'SELECT * FROM reviews WHERE id = ? AND software_id = ?'
    ).get(req.params.id, req.params.softwareId);

    if (!review) throw createError(404, 'Review not found');
    if (review.user_id !== req.user.id) throw createError(403, 'You can only edit your own reviews');

    const { rating, content } = req.body;
    if (rating !== undefined && (rating < 1 || rating > 5)) {
      throw createError(400, 'rating must be between 1 and 5');
    }

    const newRating = rating !== undefined ? rating : review.rating;
    const newContent = content !== undefined ? content : review.content;

    db.prepare(
      "UPDATE reviews SET rating = ?, content = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newRating, newContent, req.params.id);

    recalcAvgRating(db, Number(req.params.softwareId));

    res.json({ id: review.id, rating: newRating, content: newContent });
  })
);

router.delete(
  '/:softwareId/reviews/:id',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const review = db.prepare(
      'SELECT * FROM reviews WHERE id = ? AND software_id = ?'
    ).get(req.params.id, req.params.softwareId);

    if (!review) throw createError(404, 'Review not found');
    if (review.user_id !== req.user.id && req.user.role !== 'admin') {
      throw createError(403, 'You can only delete your own reviews');
    }

    db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);

    recalcAvgRating(db, Number(req.params.softwareId));

    res.json({ message: 'Review deleted' });
  })
);

router.post(
  '/:softwareId/favorite',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const softwareId = Number(req.params.softwareId);

    const software = db.prepare('SELECT id FROM software WHERE id = ?').get(softwareId);
    if (!software) throw createError(404, 'Software not found');

    const existing = db.prepare(
      'SELECT id FROM favorites WHERE user_id = ? AND software_id = ?'
    ).get(req.user.id, softwareId);

    if (existing) {
      db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
      res.json({ favorited: false });
    } else {
      db.prepare(
        'INSERT INTO favorites (user_id, software_id) VALUES (?, ?)'
      ).run(req.user.id, softwareId);
      res.json({ favorited: true });
    }
  })
);

router.get(
  '/favorites',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { page: pageStr = '1', limit: limitStr = '20' } = req.query;
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const limit = Math.max(1, parseInt(limitStr, 10) || 20);
    const offset = (page - 1) * limit;

    const total = db.prepare(
      'SELECT COUNT(*) AS total FROM favorites WHERE user_id = ?'
    ).get(req.user.id).total;

    const items = db.prepare(
      `SELECT s.*, f.created_at AS favorited_at FROM favorites f JOIN software s ON s.id = f.software_id WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT ? OFFSET ?`
    ).all(req.user.id, limit, offset);

    res.json({ items, total, page, limit });
  })
);

router.post(
  '/follow/:userId',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const followingId = Number(req.params.userId);

    if (followingId === req.user.id) {
      throw createError(400, 'You cannot follow yourself');
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(followingId);
    if (!user) throw createError(404, 'User not found');

    const existing = db.prepare(
      'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?'
    ).get(req.user.id, followingId);

    if (existing) {
      db.prepare('DELETE FROM follows WHERE id = ?').run(existing.id);
      res.json({ following: false });
    } else {
      db.prepare(
        'INSERT INTO follows (follower_id, following_id) VALUES (?, ?)'
      ).run(req.user.id, followingId);
      res.json({ following: true });
    }
  })
);

router.get(
  '/followers',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const followers = db.prepare(
      `SELECT u.id, u.username, u.avatar, f.created_at AS followed_at FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.following_id = ? ORDER BY f.created_at DESC`
    ).all(req.user.id);

    res.json({ items: followers });
  })
);

router.get(
  '/following',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const following = db.prepare(
      `SELECT u.id, u.username, u.avatar, f.created_at AS followed_at FROM follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = ? ORDER BY f.created_at DESC`
    ).all(req.user.id);

    res.json({ items: following });
  })
);

module.exports = router;
