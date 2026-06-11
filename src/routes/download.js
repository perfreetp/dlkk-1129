const express = require('express');
const { getDb } = require('../db/index');
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

router.post('/record', asyncHandler(async (req, res) => {
  const { software_id, version_id, source, ip_address, country } = req.body;

  if (!software_id) {
    throw createError(400, 'software_id is required');
  }

  const db = getDb();

  const software = db.prepare('SELECT id FROM software WHERE id = ?').get(software_id);
  if (!software) {
    throw createError(404, 'Software not found');
  }

  const insertStat = db.prepare(`
    INSERT INTO download_stats (software_id, version_id, source, ip_address, country)
    VALUES (?, ?, ?, ?, ?)
  `);
  const incrementCount = db.prepare(`
    UPDATE software SET download_count = download_count + 1, updated_at = datetime('now') WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    insertStat.run(software_id, version_id || null, source || 'direct', ip_address || '', country || '');
    incrementCount.run(software_id);
  });
  transaction();

  res.status(201).json({ message: 'Download recorded' });
}));

router.get('/software/:id', auth, requireRole('admin', 'editor'), asyncHandler(async (req, res) => {
  const db = getDb();

  const software = db.prepare('SELECT id, name, download_count FROM software WHERE id = ?').get(req.params.id);
  if (!software) {
    throw createError(404, 'Software not found');
  }

  const byVersion = db.prepare(`
    SELECT version_id, COUNT(*) AS count
    FROM download_stats
    WHERE software_id = ?
    GROUP BY version_id
  `).all(req.params.id);

  const bySource = db.prepare(`
    SELECT source, COUNT(*) AS count
    FROM download_stats
    WHERE software_id = ?
    GROUP BY source
  `).all(req.params.id);

  res.json({
    total: software.download_count,
    by_version: byVersion,
    by_source: bySource
  });
}));

router.get('/software/:id/trend', auth, requireRole('admin', 'editor'), asyncHandler(async (req, res) => {
  const db = getDb();
  const days = Math.max(1, parseInt(req.query.days) || 30);

  const trend = db.prepare(`
    SELECT DATE(downloaded_at) AS date, COUNT(*) AS count
    FROM download_stats
    WHERE software_id = ? AND downloaded_at >= datetime('now', '-' || ? || ' days')
    GROUP BY DATE(downloaded_at)
    ORDER BY date
  `).all(req.params.id, days);

  res.json(trend);
}));

router.get('/overview', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const db = getDb();

  const total = db.prepare('SELECT COALESCE(SUM(download_count), 0) AS total FROM software').get().total;

  const topSoftware = db.prepare(`
    SELECT id, name, download_count
    FROM software
    ORDER BY download_count DESC
    LIMIT 10
  `).all();

  const dailyTrend = db.prepare(`
    SELECT DATE(downloaded_at) AS date, COUNT(*) AS count
    FROM download_stats
    WHERE downloaded_at >= datetime('now', '-30 days')
    GROUP BY DATE(downloaded_at)
    ORDER BY date
  `).all();

  res.json({
    total_downloads: total,
    top_software: topSoftware,
    daily_trend: dailyTrend
  });
}));

module.exports = router;
