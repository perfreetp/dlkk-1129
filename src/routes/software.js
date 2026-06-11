const express = require('express');
const getDb = require('../db/index').getDb;
const { asyncHandler, createError } = require('../middleware/errorHandler');
const { auth, requireRole } = require('../middleware/auth');

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

  const latest_version = db.prepare(
    `SELECT * FROM versions WHERE software_id = ? ORDER BY released_at DESC LIMIT 1`
  ).get(req.params.id);

  res.json({ ...software, tags, screenshots, versions, latest_version });
}));

router.get('/:id/versions', asyncHandler((req, res) => {
  const db = getDb();
  const { page: pageStr = '1', limit: limitStr = '20' } = req.query;

  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const limit = Math.max(1, parseInt(limitStr, 10) || 20);
  const offset = (page - 1) * limit;

  const countRow = db.prepare(
    `SELECT COUNT(*) AS total FROM versions WHERE software_id = ?`
  ).get(req.params.id);
  const total = countRow.total;

  const versions = db.prepare(
    `SELECT * FROM versions WHERE software_id = ? ORDER BY released_at DESC LIMIT ? OFFSET ?`
  ).all(req.params.id, limit, offset);

  res.json({ items: versions, total, page, limit });
}));

router.get('/:id/versions/:versionId', asyncHandler((req, res) => {
  const db = getDb();
  const version = db.prepare(
    `SELECT * FROM versions WHERE id = ? AND software_id = ?`
  ).get(req.params.versionId, req.params.id);

  if (!version) throw createError(404, 'Version not found');
  res.json(version);
}));

router.post('/:id/versions', auth, asyncHandler((req, res) => {
  const db = getDb();
  const software = db.prepare(
    `SELECT * FROM software WHERE id = ?`
  ).get(req.params.id);

  if (!software) throw createError(404, 'Software not found');

  const isDeveloper = req.user.id === software.developer_id;
  const isAdminOrEditor = ['admin', 'editor'].includes(req.user.role);
  if (!isDeveloper && !isAdminOrEditor) {
    throw createError(403, 'Forbidden');
  }

  const { version_number, release_notes, compatibility, download_url, file_size, is_free, price, is_limited_free, limited_free_until } = req.body;

  if (!version_number) throw createError(400, 'version_number is required');

  const result = db.prepare(
    `INSERT INTO versions (software_id, version_number, release_notes, compatibility, download_url, file_size, is_free, price, is_limited_free, limited_free_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.params.id,
    version_number,
    release_notes || '',
    compatibility || '[]',
    download_url || '',
    file_size || 0,
    is_free !== undefined ? is_free : 1,
    price || 0,
    is_limited_free || 0,
    limited_free_until || null
  );

  const version = db.prepare(
    `SELECT * FROM versions WHERE id = ?`
  ).get(result.lastInsertRowid);

  res.status(201).json(version);
}));

router.put('/:id/versions/:versionId', auth, asyncHandler((req, res) => {
  const db = getDb();
  const software = db.prepare(
    `SELECT * FROM software WHERE id = ?`
  ).get(req.params.id);

  if (!software) throw createError(404, 'Software not found');

  const version = db.prepare(
    `SELECT * FROM versions WHERE id = ? AND software_id = ?`
  ).get(req.params.versionId, req.params.id);

  if (!version) throw createError(404, 'Version not found');

  const isDeveloper = req.user.id === software.developer_id;
  const isAdmin = req.user.role === 'admin';
  if (!isDeveloper && !isAdmin) {
    throw createError(403, 'Forbidden');
  }

  const { version_number, release_notes, compatibility, download_url, file_size, is_free, price, is_limited_free, limited_free_until, released_at } = req.body;

  db.prepare(
    `UPDATE versions SET
       version_number = COALESCE(?, version_number),
       release_notes = COALESCE(?, release_notes),
       compatibility = COALESCE(?, compatibility),
       download_url = COALESCE(?, download_url),
       file_size = COALESCE(?, file_size),
       is_free = COALESCE(?, is_free),
       price = COALESCE(?, price),
       is_limited_free = COALESCE(?, is_limited_free),
       limited_free_until = COALESCE(?, limited_free_until),
       released_at = COALESCE(?, released_at)
     WHERE id = ? AND software_id = ?`
  ).run(
    version_number,
    release_notes,
    compatibility,
    download_url,
    file_size,
    is_free,
    price,
    is_limited_free,
    limited_free_until,
    released_at,
    req.params.versionId,
    req.params.id
  );

  const updatedVersion = db.prepare(
    `SELECT * FROM versions WHERE id = ? AND software_id = ?`
  ).get(req.params.versionId, req.params.id);

  res.json(updatedVersion);
}));

router.delete('/:id/versions/:versionId', auth, requireRole('admin'), asyncHandler((req, res) => {
  const db = getDb();
  const software = db.prepare(
    `SELECT * FROM software WHERE id = ?`
  ).get(req.params.id);

  if (!software) throw createError(404, 'Software not found');

  const version = db.prepare(
    `SELECT * FROM versions WHERE id = ? AND software_id = ?`
  ).get(req.params.versionId, req.params.id);

  if (!version) throw createError(404, 'Version not found');

  db.prepare(
    `DELETE FROM versions WHERE id = ? AND software_id = ?`
  ).run(req.params.versionId, req.params.id);

  res.json({ message: 'Version deleted successfully' });
}));

module.exports = router;
