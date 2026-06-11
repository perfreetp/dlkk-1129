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

router.get(
  '/:id/activity',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const db = getDb();

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
      throw createError(404, 'Author not found');
    }

    const software = db.prepare(
      `SELECT id, name AS title, created_at, download_count, avg_rating, 'software' AS type FROM software WHERE developer_id = ? AND status = 'approved'`
    ).all(req.params.id);

    const collections = db.prepare(
      `SELECT id, title, created_at, description, 'collection' AS type FROM collections WHERE curator_id = ?`
    ).all(req.params.id);

    const posts = db.prepare(
      `SELECT id, title, created_at, like_count, reply_count, 'post' AS type FROM discussion_posts WHERE user_id = ?`
    ).all(req.params.id);

    const allItems = [...software, ...collections, ...posts];
    allItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const total = allItems.length;
    const items = allItems.slice(offset, offset + limit);

    res.json({ items, total, page, limit });
  })
);

router.get(
  '/:id/contributions',
  asyncHandler(async (req, res) => {
    const db = getDb();

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
      throw createError(404, 'Author not found');
    }

    const softwareStats = db.prepare(
      `SELECT 
        COUNT(*) AS software_count,
        COALESCE(SUM(download_count), 0) AS total_downloads,
        COALESCE(AVG(avg_rating), 0) AS avg_rating
       FROM software WHERE developer_id = ? AND status = 'approved'`
    ).get(req.params.id);

    const reviewCount = db.prepare(
      `SELECT COUNT(*) AS count FROM reviews r
       JOIN software s ON s.id = r.software_id
       WHERE s.developer_id = ?`
    ).get(req.params.id).count;

    const collectionCount = db.prepare(
      `SELECT COUNT(*) AS count FROM collections WHERE curator_id = ?`
    ).get(req.params.id).count;

    const postCount = db.prepare(
      `SELECT COUNT(*) AS count FROM discussion_posts WHERE user_id = ?`
    ).get(req.params.id).count;

    const followerCount = db.prepare(
      `SELECT COUNT(*) AS count FROM follows WHERE following_id = ?`
    ).get(req.params.id).count;

    res.json({
      software_count: softwareStats.software_count,
      total_downloads: softwareStats.total_downloads,
      avg_rating: softwareStats.avg_rating,
      review_count: reviewCount,
      collection_count: collectionCount,
      post_count: postCount,
      follower_count: followerCount
    });
  })
);

router.get(
  '/:id/discussions',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const db = getDb();

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) {
      throw createError(404, 'Author not found');
    }

    const total = db.prepare(
      `SELECT COUNT(*) AS total FROM discussion_posts WHERE user_id = ?`
    ).get(req.params.id).total;

    const items = db.prepare(
      `SELECT p.*, p.like_count, p.reply_count
       FROM discussion_posts p
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`
    ).all(req.params.id, limit, offset);

    res.json({ items, total, page, limit });
  })
);

module.exports = router;
