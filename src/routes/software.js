const express = require('express');
const getDb = require('../db/index').getDb;
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

function insertNotification(db, user_id, type, title, content, related_id) {
  db.prepare(
    'INSERT INTO notifications (user_id, type, title, content, related_id) VALUES (?, ?, ?, ?, ?)'
  ).run(user_id, type, title, content, related_id);
}

function addIsCurrentlyFree(version) {
  if (!version) return version;
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
  let is_currently_free = version.is_free;
  if (version.is_limited_free === 1) {
    const fromOk = version.limited_free_from && version.limited_free_from <= now;
    const untilOk = !version.limited_free_until || version.limited_free_until > now;
    if (fromOk && untilOk) {
      is_currently_free = 1;
    }
  }
  return { ...version, is_currently_free };
}

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
    `SELECT * FROM versions WHERE software_id = ? AND status = 'published' ORDER BY released_at DESC, id DESC LIMIT 3`
  ).all(req.params.id);

  const latest_version = db.prepare(
    `SELECT * FROM versions WHERE software_id = ? AND status = 'published' ORDER BY released_at DESC, id DESC LIMIT 1`
  ).get(req.params.id);

  res.json({
    ...software,
    tags,
    screenshots,
    versions: versions.map(addIsCurrentlyFree),
    latest_version: addIsCurrentlyFree(latest_version)
  });
}));

router.get('/:id/versions', asyncHandler((req, res) => {
  const db = getDb();
  const { page: pageStr = '1', limit: limitStr = '20', include_all } = req.query;

  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const limit = Math.max(1, parseInt(limitStr, 10) || 20);
  const offset = (page - 1) * limit;

  const software = db.prepare(
    `SELECT * FROM software WHERE id = ?`
  ).get(req.params.id);

  if (!software) throw createError(404, 'Software not found');

  let showAll = false;
  if (include_all === 'true') {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || 'macos_community_secret');
        const isDeveloper = decoded.id === software.developer_id;
        const isAdminOrEditor = ['admin', 'editor'].includes(decoded.role);
        showAll = isDeveloper || isAdminOrEditor;
      } catch (e) {
        showAll = false;
      }
    }
  }

  const statusCondition = showAll ? '' : " AND status = 'published'";

  const countRow = db.prepare(
    `SELECT COUNT(*) AS total FROM versions WHERE software_id = ?${statusCondition}`
  ).get(req.params.id);
  const total = countRow.total;

  const versions = db.prepare(
    `SELECT * FROM versions WHERE software_id = ?${statusCondition} ORDER BY released_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(req.params.id, limit, offset);

  res.json({ items: versions.map(addIsCurrentlyFree), total, page, limit });
}));

router.get('/:id/versions/:versionId', asyncHandler((req, res) => {
  const db = getDb();
  const version = db.prepare(
    `SELECT * FROM versions WHERE id = ? AND software_id = ?`
  ).get(req.params.versionId, req.params.id);

  if (!version) throw createError(404, 'Version not found');

  if (version.status !== 'published') {
    const authHeader = req.headers.authorization;
    let allowed = false;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || 'macos_community_secret');
        const software = db.prepare('SELECT developer_id FROM software WHERE id = ?').get(req.params.id);
        const isDeveloper = decoded.id === software.developer_id;
        const isAdminOrEditor = ['admin', 'editor'].includes(decoded.role);
        allowed = isDeveloper || isAdminOrEditor;
      } catch (e) {
        allowed = false;
      }
    }
    if (!allowed) throw createError(404, 'Version not found');
  }

  res.json(addIsCurrentlyFree(version));
}));

router.post('/:id/versions', auth, asyncHandler((req, res) => {
  const db = getDb();
  const software = db.prepare(
    `SELECT * FROM software WHERE id = ?`
  ).get(req.params.id);

  if (!software) throw createError(404, 'Software not found');

  if (software.status !== 'approved') {
    throw createError(400, 'Only approved software can add versions');
  }

  const isDeveloper = req.user.id === software.developer_id;
  const isAdminOrEditor = ['admin', 'editor'].includes(req.user.role);
  if (!isDeveloper && !isAdminOrEditor) {
    throw createError(403, 'Forbidden');
  }

  const {
    version_number, release_notes, compatibility, download_url, file_size,
    is_free, price, is_limited_free, limited_free_until, limited_free_from,
    status
  } = req.body;

  if (!version_number) throw createError(400, 'version_number is required');

  const versionStatus = status === 'published' ? 'published' : 'draft';

  const result = db.prepare(
    `INSERT INTO versions (software_id, version_number, release_notes, compatibility, download_url, file_size, is_free, price, is_limited_free, limited_free_until, limited_free_from, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    limited_free_until || null,
    limited_free_from || null,
    versionStatus
  );

  const version = db.prepare(
    `SELECT * FROM versions WHERE id = ?`
  ).get(result.lastInsertRowid);

  res.status(201).json(addIsCurrentlyFree(version));
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

  const {
    version_number, release_notes, compatibility, download_url, file_size,
    is_free, price, is_limited_free, limited_free_until, limited_free_from,
    released_at, status
  } = req.body;

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
       limited_free_from = COALESCE(?, limited_free_from),
       released_at = COALESCE(?, released_at),
       status = COALESCE(?, status)
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
    limited_free_from,
    released_at,
    status,
    req.params.versionId,
    req.params.id
  );

  const updatedVersion = db.prepare(
    `SELECT * FROM versions WHERE id = ? AND software_id = ?`
  ).get(req.params.versionId, req.params.id);

  res.json(addIsCurrentlyFree(updatedVersion));
}));

router.post('/:id/versions/:versionId/submit', auth, asyncHandler((req, res) => {
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

  const version = db.prepare(
    `SELECT * FROM versions WHERE id = ? AND software_id = ?`
  ).get(req.params.versionId, req.params.id);

  if (!version) throw createError(404, 'Version not found');

  if (version.status !== 'draft') {
    throw createError(400, 'Only draft versions can be submitted for review');
  }

  db.prepare(
    `UPDATE versions SET status = 'pending_review' WHERE id = ?`
  ).run(req.params.versionId);

  const updatedVersion = db.prepare(
    `SELECT * FROM versions WHERE id = ?`
  ).get(req.params.versionId);

  res.json(addIsCurrentlyFree(updatedVersion));
}));

router.put('/:id/versions/:versionId/approve', auth, requireRole('admin', 'editor'), asyncHandler((req, res) => {
  const db = getDb();

  const version = db.prepare(
    `SELECT * FROM versions WHERE id = ? AND software_id = ?`
  ).get(req.params.versionId, req.params.id);

  if (!version) throw createError(404, 'Version not found');

  if (version.status !== 'pending_review') {
    throw createError(400, 'Only pending_review versions can be approved');
  }

  db.prepare(
    `UPDATE versions SET status = 'published', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).run(req.user.id, req.params.versionId);

  const software = db.prepare(
    `SELECT developer_id FROM software WHERE id = ?`
  ).get(req.params.id);

  insertNotification(
    db,
    software.developer_id,
    'version_approved',
    'Version approved',
    `Your version "${version.version_number}" has been approved and published`,
    Number(req.params.id)
  );

  const updatedVersion = db.prepare(
    `SELECT * FROM versions WHERE id = ?`
  ).get(req.params.versionId);

  res.json(addIsCurrentlyFree(updatedVersion));
}));

router.put('/:id/versions/:versionId/reject', auth, requireRole('admin', 'editor'), asyncHandler((req, res) => {
  const db = getDb();

  const version = db.prepare(
    `SELECT * FROM versions WHERE id = ? AND software_id = ?`
  ).get(req.params.versionId, req.params.id);

  if (!version) throw createError(404, 'Version not found');

  if (version.status !== 'pending_review') {
    throw createError(400, 'Only pending_review versions can be rejected');
  }

  db.prepare(
    `UPDATE versions SET status = 'draft', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).run(req.user.id, req.params.versionId);

  const software = db.prepare(
    `SELECT developer_id FROM software WHERE id = ?`
  ).get(req.params.id);

  insertNotification(
    db,
    software.developer_id,
    'version_rejected',
    'Version rejected',
    `Your version "${version.version_number}" has been rejected and returned to draft`,
    Number(req.params.id)
  );

  const updatedVersion = db.prepare(
    `SELECT * FROM versions WHERE id = ?`
  ).get(req.params.versionId);

  res.json(addIsCurrentlyFree(updatedVersion));
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
