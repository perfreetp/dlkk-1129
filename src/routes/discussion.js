const express = require('express');
const getDb = require('../db/index').getDb;
const { auth } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

function getBlockedUserIds(db, userId) {
  if (!userId) return { blockerIds: [], blockedIds: [] };
  const blockedIds = db.prepare(
    'SELECT blocked_id FROM blocked_users WHERE blocker_id = ?'
  ).all(userId).map(r => r.blocked_id);
  const blockerIds = db.prepare(
    'SELECT blocker_id FROM blocked_users WHERE blocked_id = ?'
  ).all(userId).map(r => r.blocker_id);
  return { blockerIds, blockedIds };
}

function addBlockedFilter(conditions, params, userId, db, column = 'p.user_id') {
  if (!userId) return;
  const { blockerIds, blockedIds } = getBlockedUserIds(db, userId);
  const allExcluded = [...new Set([...blockerIds, ...blockedIds])];
  if (allExcluded.length > 0) {
    const placeholders = allExcluded.map(() => '?').join(',');
    conditions.push(`${column} NOT IN (${placeholders})`);
    params.push(...allExcluded);
  }
}

function getOptionalUserId(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'macos_community_secret');
    return decoded.id;
  } catch (e) {
    return null;
  }
}

function checkBlockedRelation(db, userId1, userId2, action) {
  if (!userId1 || !userId2 || userId1 === userId2) return;
  const blocked = db.prepare(
    `SELECT id FROM blocked_users 
     WHERE (blocker_id = ? AND blocked_id = ?) 
        OR (blocker_id = ? AND blocked_id = ?)`
  ).get(userId1, userId2, userId2, userId1);
  if (blocked) {
    throw createError(403, `Cannot ${action}: blocked relationship exists`);
  }
}

router.post('/posts', auth, asyncHandler(async (req, res) => {
  const { software_id, title, content } = req.body;
  if (!title || !content) {
    throw createError(400, 'title and content are required');
  }

  const db = getDb();
  const result = db.prepare(
    'INSERT INTO discussion_posts (software_id, user_id, title, content) VALUES (?, ?, ?, ?)'
  ).run(software_id || null, req.user.id, title, content);

  res.status(201).json({ id: result.lastInsertRowid });
}));

router.get('/posts', asyncHandler(async (req, res) => {
  const db = getDb();
  const { software_id, page: pageStr = '1', limit: limitStr = '20' } = req.query;
  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const limit = Math.max(1, parseInt(limitStr, 10) || 20);
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (software_id) {
    conditions.push('p.software_id = ?');
    params.push(Number(software_id));
  }

  const userId = getOptionalUserId(req);
  addBlockedFilter(conditions, params, userId, db, 'p.user_id');

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const totalRow = db.prepare(
    `SELECT COUNT(*) AS total FROM discussion_posts p ${where}`
  ).get(...params);
  const total = totalRow.total;

  const items = db.prepare(
    `SELECT p.*, u.username, u.avatar,
       p.like_count, p.reply_count
     FROM discussion_posts p
     JOIN users u ON u.id = p.user_id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ items, total, page, limit });
}));

router.get('/posts/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const post = db.prepare(
    `SELECT p.*, u.username, u.avatar,
       p.like_count, p.reply_count
     FROM discussion_posts p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = ?`
  ).get(req.params.id);

  if (!post) throw createError(404, 'Post not found');

  const userId = getOptionalUserId(req);
  const { blockerIds, blockedIds } = getBlockedUserIds(db, userId);
  if (blockerIds.includes(post.user_id) || blockedIds.includes(post.user_id)) {
    throw createError(404, 'Post not found');
  }

  res.json(post);
}));

router.put('/posts/:id', auth, asyncHandler(async (req, res) => {
  const { title, content } = req.body;
  const db = getDb();

  const post = db.prepare('SELECT * FROM discussion_posts WHERE id = ?').get(req.params.id);
  if (!post) throw createError(404, 'Post not found');
  if (post.user_id !== req.user.id) throw createError(403, 'Only the author can edit this post');

  const newTitle = title !== undefined ? title : post.title;
  const newContent = content !== undefined ? content : post.content;

  db.prepare(
    "UPDATE discussion_posts SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(newTitle, newContent, req.params.id);

  res.json({ id: req.params.id, title: newTitle, content: newContent });
}));

router.delete('/posts/:id', auth, asyncHandler(async (req, res) => {
  const db = getDb();

  const post = db.prepare('SELECT * FROM discussion_posts WHERE id = ?').get(req.params.id);
  if (!post) throw createError(404, 'Post not found');
  if (post.user_id !== req.user.id && req.user.role !== 'admin') {
    throw createError(403, 'Not authorized to delete this post');
  }

  db.prepare('DELETE FROM discussion_posts WHERE id = ?').run(req.params.id);
  res.json({ message: 'Post deleted' });
}));

router.post('/posts/:id/replies', auth, asyncHandler(async (req, res) => {
  const { content } = req.body;
  if (!content) throw createError(400, 'content is required');

  const db = getDb();
  const post = db.prepare('SELECT * FROM discussion_posts WHERE id = ?').get(req.params.id);
  if (!post) throw createError(404, 'Post not found');

  checkBlockedRelation(db, req.user.id, post.user_id, 'reply to this post');

  const result = db.prepare(
    'INSERT INTO discussion_replies (post_id, user_id, content) VALUES (?, ?, ?)'
  ).run(req.params.id, req.user.id, content);

  db.prepare(
    "UPDATE discussion_posts SET reply_count = reply_count + 1, updated_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);

  if (post.user_id !== req.user.id) {
    const { blockedIds } = getBlockedUserIds(db, post.user_id);
    if (!blockedIds.includes(req.user.id)) {
      db.prepare(
        'INSERT INTO notifications (user_id, type, title, content, related_id) VALUES (?, ?, ?, ?, ?)'
      ).run(
        post.user_id,
        'reply',
        'New reply to your post',
        `${req.user.username} replied to your post "${post.title}"`,
        Number(req.params.id)
      );
    }
  }

  res.status(201).json({ id: result.lastInsertRowid });
}));

router.get('/posts/:id/replies', asyncHandler(async (req, res) => {
  const db = getDb();
  const { page: pageStr = '1', limit: limitStr = '20' } = req.query;
  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const limit = Math.max(1, parseInt(limitStr, 10) || 20);
  const offset = (page - 1) * limit;

  const post = db.prepare('SELECT id FROM discussion_posts WHERE id = ?').get(req.params.id);
  if (!post) throw createError(404, 'Post not found');

  const conditions = ['r.post_id = ?'];
  const params = [req.params.id];

  const userId = getOptionalUserId(req);
  addBlockedFilter(conditions, params, userId, db, 'r.user_id');

  const where = 'WHERE ' + conditions.join(' AND ');

  const totalRow = db.prepare(
    `SELECT COUNT(*) AS total FROM discussion_replies r ${where}`
  ).get(...params);
  const total = totalRow.total;

  const items = db.prepare(
    `SELECT r.*, u.username, u.avatar, r.like_count
     FROM discussion_replies r
     JOIN users u ON u.id = r.user_id
     ${where}
     ORDER BY r.created_at ASC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ items, total, page, limit });
}));

router.post('/posts/:id/like', auth, asyncHandler(async (req, res) => {
  const db = getDb();

  const post = db.prepare('SELECT * FROM discussion_posts WHERE id = ?').get(req.params.id);
  if (!post) throw createError(404, 'Post not found');

  checkBlockedRelation(db, req.user.id, post.user_id, 'like this post');

  const existing = db.prepare(
    'SELECT * FROM post_likes WHERE post_id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (existing) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    db.prepare('UPDATE discussion_posts SET like_count = like_count - 1 WHERE id = ?').run(req.params.id);
    res.json({ liked: false });
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
    db.prepare('UPDATE discussion_posts SET like_count = like_count + 1 WHERE id = ?').run(req.params.id);
    res.json({ liked: true });
  }
}));

router.post('/replies/:id/like', auth, asyncHandler(async (req, res) => {
  const db = getDb();

  const reply = db.prepare('SELECT * FROM discussion_replies WHERE id = ?').get(req.params.id);
  if (!reply) throw createError(404, 'Reply not found');

  checkBlockedRelation(db, req.user.id, reply.user_id, 'like this reply');

  const existing = db.prepare(
    'SELECT * FROM reply_likes WHERE reply_id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (existing) {
    db.prepare('DELETE FROM reply_likes WHERE reply_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    db.prepare('UPDATE discussion_replies SET like_count = like_count - 1 WHERE id = ?').run(req.params.id);
    res.json({ liked: false });
  } else {
    db.prepare('INSERT INTO reply_likes (reply_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
    db.prepare('UPDATE discussion_replies SET like_count = like_count + 1 WHERE id = ?').run(req.params.id);
    res.json({ liked: true });
  }
}));

router.post('/report', auth, asyncHandler(async (req, res) => {
  const { target_type, target_id, reason } = req.body;
  if (!target_type || !target_id) {
    throw createError(400, 'target_type and target_id are required');
  }
  if (!['post', 'reply', 'user', 'software'].includes(target_type)) {
    throw createError(400, 'Invalid target_type');
  }

  const db = getDb();

  let targetUserId = null;

  if (target_type === 'post') {
    const post = db.prepare('SELECT user_id FROM discussion_posts WHERE id = ?').get(target_id);
    if (!post) throw createError(404, 'Post not found');
    targetUserId = post.user_id;
  } else if (target_type === 'reply') {
    const reply = db.prepare('SELECT user_id FROM discussion_replies WHERE id = ?').get(target_id);
    if (!reply) throw createError(404, 'Reply not found');
    targetUserId = reply.user_id;
  } else if (target_type === 'user') {
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(target_id);
    if (!user) throw createError(404, 'User not found');
    targetUserId = target_id;
  }

  if (targetUserId) {
    checkBlockedRelation(db, req.user.id, targetUserId, 'report this content');
  }

  const blocked = db.prepare(
    'SELECT id FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?'
  ).get(req.user.id, targetUserId);

  if (blocked) {
    throw createError(403, 'Cannot report a blocked user');
  }

  const result = db.prepare(
    'INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?)'
  ).run(req.user.id, target_type, target_id, reason || '');

  res.status(201).json({ id: result.lastInsertRowid });
}));

router.post('/block', auth, asyncHandler(async (req, res) => {
  const { blocked_id } = req.body;
  if (!blocked_id) throw createError(400, 'blocked_id is required');
  if (Number(blocked_id) === req.user.id) throw createError(400, 'Cannot block yourself');

  const db = getDb();

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(blocked_id);
  if (!user) throw createError(404, 'User not found');

  db.prepare(
    'INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)'
  ).run(req.user.id, blocked_id);

  res.json({ message: 'User blocked' });
}));

router.delete('/block/:blocked_id', auth, asyncHandler(async (req, res) => {
  const db = getDb();
  db.prepare(
    'DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?'
  ).run(req.user.id, req.params.blocked_id);
  res.json({ message: 'User unblocked' });
}));

router.get('/notifications', auth, asyncHandler(async (req, res) => {
  const db = getDb();
  const { is_read, page: pageStr = '1', limit: limitStr = '20' } = req.query;
  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const limit = Math.max(1, parseInt(limitStr, 10) || 20);
  const offset = (page - 1) * limit;

  const conditions = ['user_id = ?'];
  const params = [req.user.id];

  if (is_read !== undefined) {
    conditions.push('is_read = ?');
    params.push(Number(is_read));
  }

  const where = 'WHERE ' + conditions.join(' AND ');

  const totalRow = db.prepare(
    `SELECT COUNT(*) AS total FROM notifications ${where}`
  ).get(...params);
  const total = totalRow.total;

  const items = db.prepare(
    `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ items, total, page, limit });
}));

router.put('/notifications/:id/read', auth, asyncHandler(async (req, res) => {
  const db = getDb();
  const notification = db.prepare(
    'SELECT * FROM notifications WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!notification) throw createError(404, 'Notification not found');

  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Notification marked as read' });
}));

router.put('/notifications/read-all', auth, asyncHandler(async (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'All notifications marked as read' });
}));

module.exports = router;
