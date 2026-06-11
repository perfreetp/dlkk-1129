const express = require('express');
const getDb = require('../db/index').getDb;
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/popular', asyncHandler((req, res) => {
  const db = getDb();
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);

  const items = db.prepare(
    `SELECT * FROM software WHERE status = 'approved' ORDER BY download_count DESC LIMIT ?`
  ).all(limit);

  res.json(items);
}));

router.get('/alternatives/:softwareId', asyncHandler((req, res) => {
  const db = getDb();
  const softwareId = Number(req.params.softwareId);

  const software = db.prepare(
    `SELECT * FROM software WHERE id = ? AND status = 'approved'`
  ).get(softwareId);

  if (!software) throw createError(404, 'Software not found');

  const alternatives = db.prepare(
    `SELECT s.*, COUNT(st2.tag_id) AS shared_tags
     FROM software s
     JOIN software_tags st1 ON st1.software_id = ?
     JOIN software_tags st2 ON st2.tag_id = st1.tag_id AND st2.software_id = s.id
     WHERE s.category_id = ?
       AND s.id != ?
       AND s.status = 'approved'
     GROUP BY s.id
     ORDER BY shared_tags DESC, s.avg_rating DESC
     LIMIT 10`
  ).all(softwareId, software.category_id, softwareId);

  res.json(alternatives);
}));

router.get('/editor-picks', asyncHandler((req, res) => {
  const db = getDb();
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);

  const picks = db.prepare(
    `SELECT ep.*, u.username AS editor_username, ep.comment,
            s.name, s.description, s.icon_url, s.category_id, s.avg_rating, s.download_count, s.status
     FROM editor_picks ep
     JOIN users u ON u.id = ep.editor_id
     JOIN software s ON s.id = ep.software_id
     WHERE s.status = 'approved'
     ORDER BY ep.featured_at DESC
     LIMIT ?`
  ).all(limit);

  res.json(picks);
}));

router.get('/limited-free', asyncHandler((req, res) => {
  const db = getDb();

  const items = db.prepare(
    `SELECT s.*, v.price AS original_price, v.is_limited_free, v.limited_free_until, v.limited_free_from, v.version_number
     FROM software s
     JOIN versions v ON v.software_id = s.id
     WHERE s.status = 'approved'
       AND v.status = 'published'
       AND v.is_limited_free = 1
       AND v.limited_free_from IS NOT NULL
       AND v.limited_free_from <= datetime('now')
       AND v.limited_free_until IS NOT NULL
       AND v.limited_free_until > datetime('now')
       AND v.id = (
         SELECT v2.id FROM versions v2
         WHERE v2.software_id = s.id
           AND v2.status = 'published'
         ORDER BY v2.released_at DESC, v2.id DESC
         LIMIT 1
       )
     ORDER BY v.limited_free_until ASC`
  ).all();

  res.json(items);
}));

router.post('/editor-picks', auth, requireRole('editor', 'admin'), asyncHandler((req, res) => {
  const db = getDb();
  const { software_id, comment } = req.body;

  if (!software_id) throw createError(400, 'software_id is required');

  const software = db.prepare(
    `SELECT * FROM software WHERE id = ? AND status = 'approved'`
  ).get(software_id);

  if (!software) throw createError(404, 'Software not found');

  const result = db.prepare(
    `INSERT INTO editor_picks (software_id, editor_id, comment) VALUES (?, ?, ?)`
  ).run(software_id, req.user.id, comment || '');

  const pick = db.prepare(
    `SELECT ep.*, u.username AS editor_username FROM editor_picks ep JOIN users u ON u.id = ep.editor_id WHERE ep.id = ?`
  ).get(result.lastInsertRowid);

  res.status(201).json(pick);
}));

module.exports = router;
