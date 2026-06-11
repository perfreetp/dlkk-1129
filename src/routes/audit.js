const express = require('express');
const { getDb } = require('../db/index');
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

router.post('/:id/approve', auth, requireRole('editor', 'admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!submission) throw createError(404, 'Submission not found');
  if (submission.status !== 'pending') throw createError(400, 'Submission is not pending');

  const insertSoftware = db.prepare(`
    INSERT INTO software (name, description, website, status)
    VALUES (?, ?, ?, 'approved')
  `);
  const updateSubmission = db.prepare(`
    UPDATE submissions SET status = 'approved', updated_at = datetime('now') WHERE id = ?
  `);
  const insertAuditLog = db.prepare(`
    INSERT INTO audit_logs (submission_id, software_id, auditor_id, action, note)
    VALUES (?, ?, ?, 'approve', '')
  `);

  const result = insertSoftware.run(submission.name, submission.description, submission.website);
  const softwareId = result.lastInsertRowid;
  updateSubmission.run(req.params.id);
  insertAuditLog.run(req.params.id, softwareId, req.user.id);

  res.json({ message: 'Submission approved', software_id: softwareId });
}));

router.post('/:id/reject', auth, requireRole('editor', 'admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { note } = req.body;
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!submission) throw createError(404, 'Submission not found');
  if (submission.status !== 'pending') throw createError(400, 'Submission is not pending');

  const updateSubmission = db.prepare(`
    UPDATE submissions SET status = 'rejected', audit_note = ?, updated_at = datetime('now') WHERE id = ?
  `);
  const insertAuditLog = db.prepare(`
    INSERT INTO audit_logs (submission_id, auditor_id, action, note)
    VALUES (?, ?, 'reject', ?)
  `);

  const transaction = db.transaction(() => {
    updateSubmission.run(note || '', req.params.id);
    insertAuditLog.run(req.params.id, req.user.id, note || '');
  });
  transaction();

  res.json({ message: 'Submission rejected' });
}));

router.put('/software/:id/delist', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { note } = req.body;
  const software = db.prepare('SELECT * FROM software WHERE id = ?').get(req.params.id);
  if (!software) throw createError(404, 'Software not found');

  const updateSoftware = db.prepare(`
    UPDATE software SET status = 'delisted', updated_at = datetime('now') WHERE id = ?
  `);
  const insertAuditLog = db.prepare(`
    INSERT INTO audit_logs (software_id, auditor_id, action, note)
    VALUES (?, ?, 'delist', ?)
  `);

  const transaction = db.transaction(() => {
    updateSoftware.run(req.params.id);
    insertAuditLog.run(req.params.id, req.user.id, note || '');
  });
  transaction();

  res.json({ message: 'Software delisted' });
}));

router.put('/software/:id/risk', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { risk_note } = req.body;
  if (!risk_note) throw createError(400, 'risk_note is required');
  const software = db.prepare('SELECT * FROM software WHERE id = ?').get(req.params.id);
  if (!software) throw createError(404, 'Software not found');

  const updateSoftware = db.prepare(`
    UPDATE software SET status = 'risky', risk_note = ?, updated_at = datetime('now') WHERE id = ?
  `);
  const insertAuditLog = db.prepare(`
    INSERT INTO audit_logs (software_id, auditor_id, action, note)
    VALUES (?, ?, 'risk', ?)
  `);

  const transaction = db.transaction(() => {
    updateSoftware.run(risk_note, req.params.id);
    insertAuditLog.run(req.params.id, req.user.id, risk_note);
  });
  transaction();

  res.json({ message: 'Software marked as risky' });
}));

router.post('/merge', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  const { source_id, target_id } = req.body;
  if (!source_id || !target_id) throw createError(400, 'source_id and target_id are required');
  if (source_id === target_id) throw createError(400, 'source_id and target_id must differ');

  const source = db.prepare('SELECT * FROM software WHERE id = ?').get(source_id);
  const target = db.prepare('SELECT * FROM software WHERE id = ?').get(target_id);
  if (!source) throw createError(404, 'Source software not found');
  if (!target) throw createError(404, 'Target software not found');

  const transaction = db.transaction(() => {
    db.prepare('UPDATE reviews SET software_id = ? WHERE software_id = ?').run(target_id, source_id);
    db.prepare('UPDATE favorites SET software_id = ? WHERE software_id = ?').run(target_id, source_id);
    db.prepare('UPDATE download_stats SET software_id = ? WHERE software_id = ?').run(target_id, source_id);
    db.prepare('DELETE FROM software WHERE id = ?').run(source_id);
    db.prepare(`
      INSERT INTO audit_logs (software_id, auditor_id, action, note)
      VALUES (?, ?, 'merge', ?)
    `).run(target_id, req.user.id, `Merged software ${source_id} into ${target_id}`);
  });
  transaction();

  res.json({ message: 'Software merged successfully' });
}));

module.exports = router;
