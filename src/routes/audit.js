const express = require('express');
const { getDb } = require('../db/index');
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

function ensureSchemaColumns(db) {
  const postsColumn = db.prepare(`
    SELECT name FROM pragma_table_info('discussion_posts') WHERE name = 'is_hidden'
  `).get();
  if (!postsColumn) {
    db.exec('ALTER TABLE discussion_posts ADD COLUMN is_hidden INTEGER DEFAULT 0');
  }
  
  const repliesColumn = db.prepare(`
    SELECT name FROM pragma_table_info('discussion_replies') WHERE name = 'is_hidden'
  `).get();
  if (!repliesColumn) {
    db.exec('ALTER TABLE discussion_replies ADD COLUMN is_hidden INTEGER DEFAULT 0');
  }

  const reportsResolutionNote = db.prepare(`
    SELECT name FROM pragma_table_info('reports') WHERE name = 'resolution_note'
  `).get();
  if (!reportsResolutionNote) {
    db.exec('ALTER TABLE reports ADD COLUMN resolution_note TEXT DEFAULT \'\'');
  }

  const reportsUpdatedAt = db.prepare(`
    SELECT name FROM pragma_table_info('reports') WHERE name = 'updated_at'
  `).get();
  if (!reportsUpdatedAt) {
    db.exec('ALTER TABLE reports ADD COLUMN updated_at TEXT DEFAULT (datetime(\'now\'))');
  }
}

function ensureAuditLogActions(db) {
}

function insertNotification(db, user_id, type, title, content, related_id) {
  db.prepare(
    'INSERT INTO notifications (user_id, type, title, content, related_id) VALUES (?, ?, ?, ?, ?)'
  ).run(user_id, type, title, content, related_id);
}

function getTargetInfo(db, targetType, targetId) {
  if (targetType === 'post') {
    return db.prepare(`
      SELECT id, title, SUBSTR(content, 1, 100) AS content_preview, user_id, is_hidden
      FROM discussion_posts WHERE id = ?
    `).get(targetId);
  } else if (targetType === 'reply') {
    return db.prepare(`
      SELECT r.id, SUBSTR(r.content, 1, 100) AS content_preview, r.user_id, r.post_id, r.is_hidden,
             p.title AS post_title
      FROM discussion_replies r
      JOIN discussion_posts p ON p.id = r.post_id
      WHERE r.id = ?
    `).get(targetId);
  } else if (targetType === 'user') {
    return db.prepare(`
      SELECT id, username, avatar
      FROM users WHERE id = ?
    `).get(targetId);
  } else if (targetType === 'software') {
    return db.prepare(`
      SELECT id, name, status, developer_id
      FROM software WHERE id = ?
    `).get(targetId);
  }
  return null;
}

router.get('/reports', auth, requireRole('editor', 'admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  ensureSchemaColumns(db);
  
  const { target_type, status, page: pageStr = '1', limit: limitStr = '20', group_by } = req.query;
  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(limitStr, 10) || 20));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (target_type) {
    if (!['post', 'reply', 'user', 'software'].includes(target_type)) {
      throw createError(400, 'Invalid target_type');
    }
    conditions.push('r.target_type = ?');
    params.push(target_type);
  }

  if (status) {
    if (!['pending', 'resolved', 'dismissed'].includes(status)) {
      throw createError(400, 'Invalid status');
    }
    conditions.push('r.status = ?');
    params.push(status);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS total FROM reports r ${where}
  `).get(...params);
  const total = totalRow.total;

  let reports;
  if (group_by === 'target_type') {
    const rows = db.prepare(`
      SELECT r.*, u.username AS reporter_username
      FROM reports r
      JOIN users u ON u.id = r.reporter_id
      ${where}
      ORDER BY r.target_type, r.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    
    reports = rows.reduce((acc, row) => {
      const targetInfo = getTargetInfo(db, row.target_type, row.target_id);
      const report = { ...row, target_info: targetInfo };
      if (!acc[row.target_type]) {
        acc[row.target_type] = [];
      }
      acc[row.target_type].push(report);
      return acc;
    }, {});
  } else {
    const rows = db.prepare(`
      SELECT r.*, u.username AS reporter_username
      FROM reports r
      JOIN users u ON u.id = r.reporter_id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    
    reports = rows.map(row => ({
      ...row,
      target_info: getTargetInfo(db, row.target_type, row.target_id)
    }));
  }

  res.json({ 
    reports, 
    total, 
    page, 
    limit,
    total_pages: Math.ceil(total / limit)
  });
}));

router.put('/reports/:id/resolve', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  ensureSchemaColumns(db);
  ensureAuditLogActions(db);
  
  const { resolution_note } = req.body;
  const reportId = req.params.id;

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
  if (!report) throw createError(404, 'Report not found');
  if (report.status === 'resolved') throw createError(400, 'Report already resolved');
  if (report.status === 'dismissed') throw createError(400, 'Report already dismissed');

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE reports 
      SET status = 'resolved', resolution_note = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(resolution_note || '', reportId);

    if (report.target_type === 'post') {
      db.prepare('UPDATE discussion_posts SET is_hidden = 1 WHERE id = ?').run(report.target_id);
    } else if (report.target_type === 'reply') {
      db.prepare('UPDATE discussion_replies SET is_hidden = 1 WHERE id = ?').run(report.target_id);
    }

    db.prepare(`
      INSERT INTO audit_logs (submission_id, software_id, auditor_id, action, note, software_name, submission_name, original_software_id, original_submission_id)
      VALUES (?, ?, ?, 'resolve', ?, ?, ?, ?, ?)
    `).run(
      report.target_type === 'submission' ? report.target_id : null,
      report.target_type === 'software' ? report.target_id : null,
      req.user.id,
      resolution_note || `Resolved report #${reportId} (${report.target_type} #${report.target_id})`,
      report.target_type === 'software' ? (db.prepare('SELECT name FROM software WHERE id = ?').get(report.target_id)?.name || '') : '',
      report.target_type === 'submission' ? (db.prepare('SELECT name FROM submissions WHERE id = ?').get(report.target_id)?.name || '') : '',
      report.target_type === 'software' ? report.target_id : null,
      report.target_type === 'submission' ? report.target_id : null
    );
  });

  transaction();

  insertNotification(
    db,
    report.reporter_id,
    'report_resolved',
    '举报处理结果',
    `您举报的${report.target_type}已处理: ${resolution_note || '内容已隐藏'}`,
    report.id
  );

  if (report.target_type === 'post' || report.target_type === 'reply') {
    const targetInfo = getTargetInfo(db, report.target_type, report.target_id);
    if (targetInfo && targetInfo.user_id) {
      insertNotification(
        db,
        targetInfo.user_id,
        'content_hidden',
        '内容已被处理',
        `您的${report.target_type}因举报已被处理: ${resolution_note || '内容已隐藏'}`,
        report.id
      );
    }
  }

  res.json({ message: 'Report resolved successfully' });
}));

router.put('/reports/:id/dismiss', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  ensureAuditLogActions(db);
  
  const { resolution_note } = req.body;
  const reportId = req.params.id;

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
  if (!report) throw createError(404, 'Report not found');
  if (report.status === 'dismissed') throw createError(400, 'Report already dismissed');
  if (report.status === 'resolved') throw createError(400, 'Report already resolved');

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE reports 
      SET status = 'dismissed', resolution_note = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(resolution_note || '', reportId);

    db.prepare(`
      INSERT INTO audit_logs (submission_id, software_id, auditor_id, action, note, software_name, submission_name, original_software_id, original_submission_id)
      VALUES (?, ?, ?, 'dismiss', ?, ?, ?, ?, ?)
    `).run(
      report.target_type === 'submission' ? report.target_id : null,
      report.target_type === 'software' ? report.target_id : null,
      req.user.id,
      resolution_note || `Dismissed report #${reportId} (${report.target_type} #${report.target_id})`,
      report.target_type === 'software' ? (db.prepare('SELECT name FROM software WHERE id = ?').get(report.target_id)?.name || '') : '',
      report.target_type === 'submission' ? (db.prepare('SELECT name FROM submissions WHERE id = ?').get(report.target_id)?.name || '') : '',
      report.target_type === 'software' ? report.target_id : null,
      report.target_type === 'submission' ? report.target_id : null
    );
  });

  transaction();

  insertNotification(
    db,
    report.reporter_id,
    'report_dismissed',
    '举报已驳回',
    `您举报的${report.target_type}经审核未违规`,
    report.id
  );

  if (report.target_type === 'post' || report.target_type === 'reply') {
    const targetInfo = getTargetInfo(db, report.target_type, report.target_id);
    if (targetInfo && targetInfo.user_id) {
      insertNotification(
        db,
        targetInfo.user_id,
        'report_cleared',
        '举报已驳回',
        '您的内容经审核未违规，已恢复显示',
        report.id
      );
    }
  }

  res.json({ message: 'Report dismissed successfully' });
}));

router.get('/reports/stats', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  
  const byTargetType = db.prepare(`
    SELECT target_type, status, COUNT(*) AS count
    FROM reports
    GROUP BY target_type, status
    ORDER BY target_type, status
  `).all();

  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM reports
    GROUP BY status
    ORDER BY status
  `).all();

  const total = db.prepare('SELECT COUNT(*) AS total FROM reports').get().total;

  const stats = {
    total,
    by_status: byStatus.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, { pending: 0, resolved: 0, dismissed: 0 }),
    by_target_type: byTargetType.reduce((acc, row) => {
      if (!acc[row.target_type]) {
        acc[row.target_type] = { pending: 0, resolved: 0, dismissed: 0, total: 0 };
      }
      acc[row.target_type][row.status] = row.count;
      acc[row.target_type].total += row.count;
      return acc;
    }, {})
  };

  res.json(stats);
}));

router.get('/dashboard', auth, requireRole('editor', 'admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  const days = Math.max(1, parseInt(req.query.days, 10) || 30);
  const { action } = req.query;

  const validActions = ['approve', 'reject', 'delist', 'risk', 'merge', 'resolve', 'dismiss', 'delete'];
  const actionFilter = action && validActions.includes(action) ? action : null;

  const trendCondition = actionFilter ? "AND action = ?" : "";
  const trendParams = actionFilter ? [actionFilter] : [];

  const event_trends = db.prepare(`
    SELECT DATE(created_at) AS date, action, COUNT(*) AS count
    FROM audit_logs
    WHERE DATE(created_at) >= DATE('now', '-' || ? || ' days')
    ${trendCondition}
    GROUP BY DATE(created_at), action
    ORDER BY date DESC, action
  `).all(days, ...trendParams);

  const summaryRows = db.prepare(`
    SELECT action, COUNT(*) AS count
    FROM audit_logs
    WHERE DATE(created_at) >= DATE('now', '-' || ? || ' days')
    GROUP BY action
  `).all(days);

  const action_summary = { approve: 0, reject: 0, delist: 0, risk: 0, merge: 0, resolve: 0, dismiss: 0, delete: 0 };
  for (const row of summaryRows) {
    if (action_summary.hasOwnProperty(row.action)) {
      action_summary[row.action] = row.count;
    }
  }

  const recent_events = db.prepare(`
    SELECT al.*, u.username AS auditor_username,
           COALESCE(s.name, al.software_name, '(已删除)') AS software_name,
           COALESCE(sub.name, al.submission_name, '') AS submission_name
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.auditor_id
    LEFT JOIN software s ON s.id = al.software_id
    LEFT JOIN submissions sub ON sub.id = al.submission_id
    ORDER BY al.created_at DESC
    LIMIT 20
  `).all();

  res.json({ event_trends, action_summary, recent_events });
}));

router.get('/dashboard/software/:id', auth, requireRole('editor', 'admin'), asyncHandler(async (req, res) => {
  const db = getDb();

  const software = db.prepare('SELECT * FROM software WHERE id = ?').get(req.params.id);

  const audit_logs = db.prepare(`
    SELECT al.*, u.username AS auditor_username
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.auditor_id
    WHERE al.software_id = ? OR al.original_software_id = ?
    ORDER BY al.created_at DESC
  `).all(req.params.id, req.params.id);

  const softwareName = software ? software.name : (audit_logs.find(l => l.software_name)?.software_name) || '(已删除)';
  res.json({ software: software || { id: parseInt(req.params.id), name: softwareName }, audit_logs });
}));

router.get('/dashboard/user/:id', auth, requireRole('editor', 'admin'), asyncHandler(async (req, res) => {
  const db = getDb();

  const user = db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) throw createError(404, 'User not found');

  const audit_logs = db.prepare(`
    SELECT al.*, COALESCE(s.name, al.software_name, '(已删除)') AS software_name, COALESCE(sub.name, al.submission_name, '') AS submission_name
    FROM audit_logs al
    LEFT JOIN software s ON s.id = al.software_id
    LEFT JOIN submissions sub ON sub.id = al.submission_id
    WHERE al.auditor_id = ?
    ORDER BY al.created_at DESC
  `).all(req.params.id);

  const submissions = db.prepare(`
    SELECT id, name, status, created_at, updated_at
    FROM submissions
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.params.id);

  res.json({ user, audit_logs, submissions });
}));

router.post('/:id/approve', auth, requireRole('editor', 'admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!submission) throw createError(404, 'Submission not found');
  if (submission.status !== 'pending') throw createError(400, 'Submission is not pending');

  const insertSoftware = db.prepare(`
    INSERT INTO software (name, description, website, status, developer_id)
    VALUES (?, ?, ?, 'approved', ?)
  `);
  const updateSubmission = db.prepare(`
    UPDATE submissions SET status = 'approved', updated_at = datetime('now'), merged_to = ? WHERE id = ?
  `);
  const insertAuditLog = db.prepare(`
    INSERT INTO audit_logs (submission_id, software_id, auditor_id, action, note, software_name, submission_name, original_software_id, original_submission_id)
    VALUES (?, ?, ?, 'approve', '', ?, ?, ?, ?)
  `);
  const insertVersion = db.prepare(`
    INSERT INTO versions (software_id, version_number, release_notes, compatibility)
    VALUES (?, '1.0.0', ?, ?)
  `);
  const insertScreenshot = db.prepare(`
    INSERT INTO screenshots (software_id, image_url, sort_order)
    VALUES (?, ?, ?)
  `);
  const insertTag = db.prepare(`
    INSERT OR IGNORE INTO tags (name) VALUES (?)
  `);
  const getTagId = db.prepare(`
    SELECT id FROM tags WHERE name = ?
  `);
  const insertSoftwareTag = db.prepare(`
    INSERT OR IGNORE INTO software_tags (software_id, tag_id)
    VALUES (?, ?)
  `);

  const screenshots = JSON.parse(submission.screenshots || '[]');
  const compatibility = JSON.parse(submission.compatibility || '[]');
  const tags = JSON.parse(submission.tags || '[]');

  const transaction = db.transaction(() => {
    const result = insertSoftware.run(
      submission.name,
      submission.description,
      submission.website,
      submission.user_id
    );
    const softwareId = result.lastInsertRowid;

    insertVersion.run(softwareId, submission.version_notes || '', JSON.stringify(compatibility));

    screenshots.forEach((url, index) => {
      insertScreenshot.run(softwareId, url, index);
    });

    tags.forEach((tagName) => {
      insertTag.run(tagName);
      const tag = getTagId.get(tagName);
      if (tag) {
        insertSoftwareTag.run(softwareId, tag.id);
      }
    });

    updateSubmission.run(softwareId, req.params.id);
    insertAuditLog.run(req.params.id, softwareId, req.user.id, submission.name, submission.name, softwareId, req.params.id);

    insertNotification(
      db,
      submission.user_id,
      'audit_approved',
      '投稿审核通过',
      `您的投稿 \"${submission.name}\" 已通过审核`,
      softwareId
    );

    return softwareId;
  });

  const softwareId = transaction();

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
    INSERT INTO audit_logs (submission_id, auditor_id, action, note, software_name, submission_name, original_submission_id)
    VALUES (?, ?, 'reject', ?, '', ?, ?)
  `);

  const transaction = db.transaction(() => {
    updateSubmission.run(note || '', req.params.id);
    insertAuditLog.run(req.params.id, req.user.id, note || '', submission.name, req.params.id);
    insertNotification(
      db,
      submission.user_id,
      'audit_rejected',
      '投稿审核未通过',
      `您的投稿 \"${submission.name}\" 未通过审核${note ? `: ${note}` : ''}`,
      null
    );
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
    INSERT INTO audit_logs (software_id, auditor_id, action, note, software_name, original_software_id)
    VALUES (?, ?, 'delist', ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    updateSoftware.run(req.params.id);
    insertAuditLog.run(req.params.id, req.user.id, note || '', software.name, req.params.id);

    if (software.developer_id) {
      insertNotification(
        db,
        software.developer_id,
        'audit_delisted',
        '软件已下架',
        `您的软件 \"${software.name}\" 已被下架${note ? `: ${note}` : ''}`,
        Number(req.params.id)
      );
    }
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
    INSERT INTO audit_logs (software_id, auditor_id, action, note, software_name, original_software_id)
    VALUES (?, ?, 'risk', ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    updateSoftware.run(risk_note, req.params.id);
    insertAuditLog.run(req.params.id, req.user.id, risk_note, software.name, req.params.id);

    if (software.developer_id) {
      insertNotification(
        db,
        software.developer_id,
        'audit_risk',
        '软件风险提示',
        `您的软件 \"${software.name}\" 被标记为风险: ${risk_note}`,
        Number(req.params.id)
      );
    }
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
    const duplicateFavs = db.prepare(`
      SELECT f.user_id FROM favorites f
      WHERE f.software_id = ? AND f.user_id IN (
        SELECT user_id FROM favorites WHERE software_id = ?
      )
    `).all(target_id, source_id);

    const duplicateUserIds = duplicateFavs.map(f => f.user_id);
    if (duplicateUserIds.length > 0) {
      const placeholders = duplicateUserIds.map(() => '?').join(',');
      db.prepare(`
        DELETE FROM favorites
        WHERE software_id = ? AND user_id IN (${placeholders})
      `).run(source_id, ...duplicateUserIds);
    }

    db.prepare('UPDATE reviews SET software_id = ? WHERE software_id = ?').run(target_id, source_id);
    db.prepare('UPDATE favorites SET software_id = ? WHERE software_id = ?').run(target_id, source_id);
    db.prepare('UPDATE download_stats SET software_id = ? WHERE software_id = ?').run(target_id, source_id);

    const reviewCount = db.prepare('SELECT COUNT(*) AS c FROM reviews WHERE software_id = ?').get(target_id).c;
    if (reviewCount > 0) {
      const avgRow = db.prepare('SELECT AVG(rating) AS avg FROM reviews WHERE software_id = ?').get(target_id);
      const avg = avgRow.avg !== null ? Math.round(avgRow.avg * 10) / 10 : 0;
      db.prepare('UPDATE software SET avg_rating = ? WHERE id = ?').run(avg, target_id);
    }

    const targetDownloads = db.prepare('SELECT SUM(download_count) AS total FROM software WHERE id IN (?, ?)').get(source_id, target_id).total || 0;
    db.prepare('UPDATE software SET download_count = ? WHERE id = ?').run(targetDownloads, target_id);

    db.prepare('DELETE FROM software WHERE id = ?').run(source_id);
    db.prepare(`
      INSERT INTO audit_logs (software_id, auditor_id, action, note, software_name, original_software_id)
      VALUES (?, ?, 'merge', ?, ?, ?)
    `).run(target_id, req.user.id, `Merged software ${source_id} into ${target_id}`, target.name, target_id);
  });
  transaction();

  res.json({ message: 'Software merged successfully' });
}));

router.delete('/software/:id', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const db = getDb();
  const note = req.body ? req.body.note : '';
  const software = db.prepare('SELECT * FROM software WHERE id = ?').get(req.params.id);
  if (!software) throw createError(404, 'Software not found');

  const updateSoftware = db.prepare(`
    UPDATE software SET status = 'delisted', updated_at = datetime('now') WHERE id = ?
  `);
  const deleteSoftware = db.prepare(`
    DELETE FROM software WHERE id = ?
  `);
  const insertAuditLog = db.prepare(`
    INSERT INTO audit_logs (software_id, auditor_id, action, note, software_name, original_software_id)
    VALUES (?, ?, 'delete', ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    updateSoftware.run(req.params.id);

    if (software.developer_id) {
      insertNotification(
        db,
        software.developer_id,
        'audit_deleted',
        '软件已删除',
        `您的软件 \"${software.name}\" 已被删除${note ? `: ${note}` : ''}`,
        Number(req.params.id)
      );
    }

    insertAuditLog.run(req.params.id, req.user.id, note || `Deleted software: ${software.name}`, software.name, req.params.id);
    deleteSoftware.run(req.params.id);
  });
  transaction();

  res.json({ message: 'Software deleted' });
}));

module.exports = router;
