const express = require('express');
const { getDb } = require('../db/index');
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const { is_official } = req.query;

    const db = getDb();

    const conditions = [];
    const params = [];

    if (is_official !== undefined) {
      conditions.push('c.is_official = ?');
      params.push(is_official ? 1 : 0);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const total = db.prepare(
      `SELECT COUNT(*) AS total FROM collections c ${where}`
    ).get(...params).total;

    const items = db.prepare(
      `SELECT c.*, COUNT(ci.id) AS item_count FROM collections c LEFT JOIN collection_items ci ON ci.collection_id = c.id ${where} GROUP BY c.id ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({ items, total, page, limit });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();

    const collection = db.prepare(
      'SELECT * FROM collections WHERE id = ?'
    ).get(req.params.id);

    if (!collection) {
      throw createError(404, 'Collection not found');
    }

    const items = db.prepare(
      `SELECT ci.*, s.id AS software_id, s.name, s.icon_url, s.avg_rating FROM collection_items ci JOIN software s ON s.id = ci.software_id WHERE ci.collection_id = ? ORDER BY ci.sort_order`
    ).all(req.params.id);

    res.json({ ...collection, items });
  })
);

router.post(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const { title, description, cover_url, is_official } = req.body;

    if (!title) {
      throw createError(400, 'Title is required');
    }

    const db = getDb();

    if (is_official && req.user.role !== 'admin') {
      throw createError(403, 'Only admins can create official collections');
    }

    const result = db.prepare(
      `INSERT INTO collections (title, description, cover_url, curator_id, is_official) VALUES (?, ?, ?, ?, ?)`
    ).run(
      title,
      description || '',
      cover_url || '',
      req.user.id,
      is_official && req.user.role === 'admin' ? 1 : 0
    );

    res.status(201).json({ id: result.lastInsertRowid });
  })
);

router.put(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();

    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!collection) {
      throw createError(404, 'Collection not found');
    }

    if (collection.curator_id !== req.user.id && req.user.role !== 'admin') {
      throw createError(403, 'Only the curator or admin can edit this collection');
    }

    const { title, description, cover_url, is_official } = req.body;

    if (is_official !== undefined && req.user.role !== 'admin') {
      throw createError(403, 'Only admins can change official status');
    }

    const updatedTitle = title !== undefined ? title : collection.title;
    const updatedDescription = description !== undefined ? description : collection.description;
    const updatedCoverUrl = cover_url !== undefined ? cover_url : collection.cover_url;
    const updatedIsOfficial = is_official !== undefined ? (is_official ? 1 : 0) : collection.is_official;

    db.prepare(
      `UPDATE collections SET title = ?, description = ?, cover_url = ?, is_official = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(updatedTitle, updatedDescription, updatedCoverUrl, updatedIsOfficial, req.params.id);

    const updated = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    res.json(updated);
  })
);

router.delete(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();

    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!collection) {
      throw createError(404, 'Collection not found');
    }

    if (collection.curator_id !== req.user.id && req.user.role !== 'admin') {
      throw createError(403, 'Only the curator or admin can delete this collection');
    }

    db.prepare('DELETE FROM collections WHERE id = ?').run(req.params.id);

    res.json({ message: 'Collection deleted' });
  })
);

router.post(
  '/:id/items',
  auth,
  asyncHandler(async (req, res) => {
    const { software_id, note, sort_order } = req.body;

    if (!software_id) {
      throw createError(400, 'software_id is required');
    }

    const db = getDb();

    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!collection) {
      throw createError(404, 'Collection not found');
    }

    if (collection.curator_id !== req.user.id && req.user.role !== 'admin') {
      throw createError(403, 'Only the curator or admin can add items to this collection');
    }

    const software = db.prepare('SELECT * FROM software WHERE id = ?').get(software_id);
    if (!software) {
      throw createError(404, 'Software not found');
    }

    if (software.status !== 'approved') {
      throw createError(400, 'Only approved software can be added to collections');
    }

    const existing = db.prepare(
      'SELECT id FROM collection_items WHERE collection_id = ? AND software_id = ?'
    ).get(req.params.id, software_id);

    if (existing) {
      throw createError(409, 'Software already exists in this collection');
    }

    const result = db.prepare(
      `INSERT INTO collection_items (collection_id, software_id, note, sort_order) VALUES (?, ?, ?, ?)`
    ).run(req.params.id, software_id, note || '', sort_order || 0);

    res.status(201).json({ id: result.lastInsertRowid });
  })
);

router.delete(
  '/:id/items/:softwareId',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();

    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!collection) {
      throw createError(404, 'Collection not found');
    }

    if (collection.curator_id !== req.user.id && req.user.role !== 'admin') {
      throw createError(403, 'Only the curator or admin can remove items from this collection');
    }

    const item = db.prepare(
      'SELECT * FROM collection_items WHERE collection_id = ? AND software_id = ?'
    ).get(req.params.id, req.params.softwareId);

    if (!item) {
      throw createError(404, 'Item not found in this collection');
    }

    db.prepare(
      'DELETE FROM collection_items WHERE collection_id = ? AND software_id = ?'
    ).run(req.params.id, req.params.softwareId);

    res.json({ message: 'Item removed from collection' });
  })
);

router.put(
  '/:id/items/reorder',
  auth,
  asyncHandler(async (req, res) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      throw createError(400, 'items array is required');
    }

    const db = getDb();

    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!collection) {
      throw createError(404, 'Collection not found');
    }

    if (collection.curator_id !== req.user.id && req.user.role !== 'admin') {
      throw createError(403, 'Only the curator or admin can reorder items in this collection');
    }

    const updateItem = db.prepare(
      'UPDATE collection_items SET sort_order = ? WHERE collection_id = ? AND software_id = ?'
    );

    const reorder = db.transaction((items) => {
      for (const item of items) {
        updateItem.run(item.sort_order, req.params.id, item.software_id);
      }
    });

    reorder(items);

    res.json({ message: 'Items reordered' });
  })
);

module.exports = router;
