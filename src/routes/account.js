const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const getDb = require('../db/index').getDb;
const { auth } = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'macos_community_secret';

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      throw createError(400, 'username, email and password are required');
    }

    const db = getDb();

    const existing = db
      .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
      .get(username, email);
    if (existing) {
      throw createError(409, 'Username or email already exists');
    }

    const password_hash = await bcrypt.hash(password, 10);

    const result = db
      .prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
      .run(username, email, password_hash);

    const token = jwt.sign({ id: result.lastInsertRowid, username, role: 'user' }, JWT_SECRET, {
      expiresIn: '7d',
    });

    res.status(201).json({ id: result.lastInsertRowid, token });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      throw createError(400, 'email and password are required');
    }

    const db = getDb();

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      throw createError(401, 'Invalid email or password');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw createError(401, 'Invalid email or password');
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        bio: user.bio,
        role: user.role,
      },
      token,
    });
  })
);

router.get(
  '/profile',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = db
      .prepare('SELECT id, username, email, avatar, bio, role, notification_settings, created_at, updated_at FROM users WHERE id = ?')
      .get(req.user.id);
    if (!user) {
      throw createError(404, 'User not found');
    }
    res.json(user);
  })
);

router.put(
  '/profile',
  auth,
  asyncHandler(async (req, res) => {
    const { avatar, bio, username } = req.body;
    const db = getDb();

    if (username && username !== req.user.username) {
      const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.user.id);
      if (taken) {
        throw createError(409, 'Username already taken');
      }
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      throw createError(404, 'User not found');
    }

    const newUsername = username || user.username;
    const newAvatar = avatar !== undefined ? avatar : user.avatar;
    const newBio = bio !== undefined ? bio : user.bio;

    db.prepare('UPDATE users SET username = ?, avatar = ?, bio = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(newUsername, newAvatar, newBio, req.user.id);

    res.json({
      id: req.user.id,
      username: newUsername,
      email: user.email,
      avatar: newAvatar,
      bio: newBio,
      role: user.role,
    });
  })
);

router.get(
  '/notification-settings',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db.prepare('SELECT notification_settings FROM users WHERE id = ?').get(req.user.id);
    if (!row) {
      throw createError(404, 'User not found');
    }
    let settings = {};
    try {
      settings = JSON.parse(row.notification_settings || '{}');
    } catch {
      settings = {};
    }
    res.json(settings);
  })
);

router.put(
  '/notification-settings',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const json = JSON.stringify(req.body);
    db.prepare('UPDATE users SET notification_settings = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(json, req.user.id);
    res.json(req.body);
  })
);

router.get(
  '/contributions',
  auth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const userId = req.user.id;

    const submissions = db.prepare('SELECT COUNT(*) AS count FROM submissions WHERE user_id = ?').get(userId).count;
    const reviews = db.prepare('SELECT COUNT(*) AS count FROM reviews WHERE user_id = ?').get(userId).count;
    const posts = db.prepare('SELECT COUNT(*) AS count FROM discussion_posts WHERE user_id = ?').get(userId).count;

    res.json({ submissions, reviews, posts });
  })
);

router.put(
  '/password',
  auth,
  asyncHandler(async (req, res) => {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) {
      throw createError(400, 'old_password and new_password are required');
    }

    const db = getDb();
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      throw createError(404, 'User not found');
    }

    const valid = await bcrypt.compare(old_password, user.password_hash);
    if (!valid) {
      throw createError(401, 'Old password is incorrect');
    }

    const hash = await bcrypt.hash(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(hash, req.user.id);

    res.json({ message: 'Password updated' });
  })
);

module.exports = router;
