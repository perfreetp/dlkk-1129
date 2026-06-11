const express = require('express');
const getDb = require('../db/index').getDb;
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/search', asyncHandler((req, res) => {
  const db = getDb();
  const { q = '', category_id, tag, page: pageStr = '1', limit: limitStr = '20' } = req.query;

  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const limit = Math.max(1, parseInt(limitStr, 10) || 20);
  const offset = (page - 1) * limit;

  const conditions = ["s.status = 'approved'"];
  const params = [];

  if (q) {
    conditions.push('s.name LIKE ?');
    params.push(`%${q}%`);
  }

  if (category_id) {
    conditions.push('s.category_id = ?');
    params.push(Number(category_id));
  }

  let joinClause = '';
  if (tag) {
    joinClause = ` JOIN software_tags st ON st.software_id = s.id JOIN tags t ON t.id = st.tag_id`;
    conditions.push('t.name = ?');
    params.push(tag);
  }

  const where = 'WHERE ' + conditions.join(' AND ');

  const countRow = db.prepare(`SELECT COUNT(DISTINCT s.id) AS total FROM software s${joinClause} ${where}`).get(...params);
  const total = countRow.total;

  const items = db.prepare(
    `SELECT DISTINCT s.* FROM software s${joinClause} ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ items, total, page, limit });
}));

router.get('/categories', asyncHandler((req, res) => {
  const db = getDb();
  const categories = db.prepare(
    `SELECT c.*, COUNT(s.id) AS software_count FROM categories c LEFT JOIN software s ON s.category_id = c.id AND s.status = 'approved' GROUP BY c.id ORDER BY c.sort_order`
  ).all();
  res.json(categories);
}));

router.get('/:id', asyncHandler((req, res) => {
  const db = getDb();
  const software = db.prepare(
    `SELECT s.*, c.name AS category_name FROM software s LEFT JOIN categories c ON c.id = s.category_id WHERE s.id = ?`
  ).get(req.params.id);

  if (!software) throw createError(404, 'Software not found');

  const tags = db.prepare(
    `SELECT t.id, t.name FROM tags t JOIN software_tags st ON st.tag_id = t.id WHERE st.software_id = ?`
  ).all(req.params.id);

  const screenshots = db.prepare(
    `SELECT * FROM screenshots WHERE software_id = ? ORDER BY sort_order`
  ).all(req.params.id);

  const versions = db.prepare(
    `SELECT * FROM versions WHERE software_id = ? ORDER BY released_at DESC LIMIT 3`
  ).all(req.params.id);

  res.json({ ...software, tags, screenshots, versions });
}));

router.get('/:id/versions', asyncHandler((req, res) => {
  const db = getDb();
  const versions = db.prepare(
    `SELECT * FROM versions WHERE software_id = ? ORDER BY released_at DESC`
  ).all(req.params.id);
  res.json(versions);
}));

router.get('/:id/versions/:versionId', asyncHandler((req, res) => {
  const db = getDb();
  const version = db.prepare(
    `SELECT * FROM versions WHERE id = ? AND software_id = ?`
  ).get(req.params.versionId, req.params.id);

  if (!version) throw createError(404, 'Version not found');
  res.json(version);
}));

module.exports = router;
