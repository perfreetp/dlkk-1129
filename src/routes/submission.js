const express = require('express');
const { getDb } = require('../db/index');
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

router.post(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const { name, website, description, screenshots, version_notes, compatibility, tags } = req.body;

    if (!name) {
      throw createError(400, 'Name is required');
    }

    const db = getDb();

    const result = db.prepare(`
      INSERT INTO submissions (user_id, name, website, description, screenshots, version_notes, compatibility, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      name,
      website || '',
      description || '',
      JSON.stringify(screenshots || []),
      version_notes || '',
      JSON.stringify(compatibility || []),
      JSON.stringify(tags || [])
    );

    res.status(201).json({ id: result.lastInsertRowid });
  })
);

router.get(
  '/',
  auth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status;

    const db = getDb();

    let countQuery = 'SELECT COUNT(*) AS total FROM submissions';
    let listQuery = `
      SELECT s.*, u.username
      FROM submissions s
      JOIN users u ON s.user_id = u.id
    `;
    const params = [];

    if (status) {
      countQuery += ' WHERE status = ?';
      listQuery += ' WHERE s.status = ?';
      params.push(status);
    }

    listQuery += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';

    const total = db.prepare(countQuery).get(...params).total;
    const rows = db.prepare(listQuery).all(...params, limit, offset);

    const submissions = rows.map((row) => ({
      ...row,
      screenshots: JSON.parse(row.screenshots),
      compatibility: JSON.parse(row.compatibility),
      tags: JSON.parse(row.tags),
    }));

    res.json({
      submissions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  })
);

router.get(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();

    const submission = db.prepare(`
      SELECT s.*, u.username
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      WHERE s.id = ?
    `).get(req.params.id);

    if (!submission) {
      throw createError(404, 'Submission not found');
    }

    if (submission.user_id !== req.user.id && req.user.role !== 'admin') {
      throw createError(403, 'Access denied');
    }

    submission.screenshots = JSON.parse(submission.screenshots);
    submission.compatibility = JSON.parse(submission.compatibility);
    submission.tags = JSON.parse(submission.tags);

    res.json(submission);
  })
);

router.put(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();

    const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);

    if (!submission) {
      throw createError(404, 'Submission not found');
    }

    if (submission.user_id !== req.user.id) {
      throw createError(403, 'Only the submitter can edit this submission');
    }

    if (submission.status !== 'pending') {
      throw createError(400, 'Only pending submissions can be edited');
    }

    const {
      name,
      website,
      description,
      screenshots,
      version_notes,
      compatibility,
      tags,
    } = req.body;

    const updatedName = name !== undefined ? name : submission.name;
    const updatedWebsite = website !== undefined ? website : submission.website;
    const updatedDescription = description !== undefined ? description : submission.description;
    const updatedScreenshots = screenshots !== undefined ? JSON.stringify(screenshots) : submission.screenshots;
    const updatedVersionNotes = version_notes !== undefined ? version_notes : submission.version_notes;
    const updatedCompatibility = compatibility !== undefined ? JSON.stringify(compatibility) : submission.compatibility;
    const updatedTags = tags !== undefined ? JSON.stringify(tags) : submission.tags;

    db.prepare(`
      UPDATE submissions
      SET name = ?, website = ?, description = ?, screenshots = ?,
          version_notes = ?, compatibility = ?, tags = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      updatedName,
      updatedWebsite,
      updatedDescription,
      updatedScreenshots,
      updatedVersionNotes,
      updatedCompatibility,
      updatedTags,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
    updated.screenshots = JSON.parse(updated.screenshots);
    updated.compatibility = JSON.parse(updated.compatibility);
    updated.tags = JSON.parse(updated.tags);

    res.json(updated);
  })
);

router.delete(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();

    const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);

    if (!submission) {
      throw createError(404, 'Submission not found');
    }

    if (submission.user_id !== req.user.id && req.user.role !== 'admin') {
      throw createError(403, 'Only the submitter or admin can delete this submission');
    }

    if (submission.status !== 'pending') {
      throw createError(400, 'Only pending submissions can be deleted');
    }

    db.prepare('DELETE FROM submissions WHERE id = ?').run(req.params.id);

    res.json({ message: 'Submission deleted' });
  })
);

module.exports = router;
