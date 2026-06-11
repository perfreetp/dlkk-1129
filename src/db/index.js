const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'macos_community.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initSchema() {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      role TEXT DEFAULT 'user' CHECK(role IN ('user','editor','admin')),
      notification_settings TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      parent_id INTEGER DEFAULT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS software (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      website TEXT DEFAULT '',
      icon_url TEXT DEFAULT '',
      category_id INTEGER,
      developer_id INTEGER,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','delisted','risky')),
      risk_note TEXT DEFAULT '',
      avg_rating REAL DEFAULT 0,
      download_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (developer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      software_id INTEGER NOT NULL,
      version_number TEXT NOT NULL,
      release_notes TEXT DEFAULT '',
      compatibility TEXT DEFAULT '[]',
      download_url TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      is_free INTEGER DEFAULT 1,
      price REAL DEFAULT 0,
      is_limited_free INTEGER DEFAULT 0,
      limited_free_until TEXT,
      limited_free_from TEXT,
      status TEXT DEFAULT 'published' CHECK(status IN ('draft','pending_review','published')),
      reviewed_by INTEGER,
      reviewed_at TEXT,
      released_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      software_id INTEGER NOT NULL,
      image_url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS software_tags (
      software_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (software_id, tag_id),
      FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      software_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      content TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      software_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, software_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL,
      following_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(follower_id, following_id),
      FOREIGN KEY (follower_id) REFERENCES users(id),
      FOREIGN KEY (following_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      website TEXT DEFAULT '',
      description TEXT DEFAULT '',
      screenshots TEXT DEFAULT '[]',
      version_notes TEXT DEFAULT '',
      compatibility TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','merged')),
      audit_note TEXT DEFAULT '',
      merged_to INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (merged_to) REFERENCES software(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER,
      software_id INTEGER,
      auditor_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('approve','reject','delist','risk','merge','delete','resolve','dismiss')),
      note TEXT DEFAULT '',
      software_name TEXT DEFAULT '',
      submission_name TEXT DEFAULT '',
      original_software_id INTEGER,
      original_submission_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE SET NULL,
      FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE SET NULL,
      FOREIGN KEY (auditor_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS discussion_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      software_id INTEGER,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      like_count INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS discussion_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      like_count INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES discussion_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS post_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES discussion_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reply_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reply_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(reply_id, user_id),
      FOREIGN KEY (reply_id) REFERENCES discussion_replies(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('post','reply','user','software')),
      target_id INTEGER NOT NULL,
      reason TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
      resolution_note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (reporter_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS blocked_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blocker_id INTEGER NOT NULL,
      blocked_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(blocker_id, blocked_id),
      FOREIGN KEY (blocker_id) REFERENCES users(id),
      FOREIGN KEY (blocked_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      related_id INTEGER,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      cover_url TEXT DEFAULT '',
      curator_id INTEGER,
      is_official INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (curator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS collection_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL,
      software_id INTEGER NOT NULL,
      note TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS download_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      software_id INTEGER NOT NULL,
      version_id INTEGER,
      source TEXT DEFAULT 'direct',
      ip_address TEXT DEFAULT '',
      country TEXT DEFAULT '',
      downloaded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE CASCADE,
      FOREIGN KEY (version_id) REFERENCES versions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS editor_picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      software_id INTEGER NOT NULL,
      editor_id INTEGER NOT NULL,
      comment TEXT DEFAULT '',
      featured_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (software_id) REFERENCES software(id) ON DELETE CASCADE,
      FOREIGN KEY (editor_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_software_name ON software(name);
    CREATE INDEX IF NOT EXISTS idx_software_category ON software(category_id);
    CREATE INDEX IF NOT EXISTS idx_software_status ON software(status);
    CREATE INDEX IF NOT EXISTS idx_versions_software ON versions(software_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_software ON reviews(software_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
    CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
    CREATE INDEX IF NOT EXISTS idx_posts_software ON discussion_posts(software_id);
    CREATE INDEX IF NOT EXISTS idx_posts_user ON discussion_posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_replies_post ON discussion_replies(post_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_download_stats_software ON download_stats(software_id);
    CREATE INDEX IF NOT EXISTS idx_download_stats_date ON download_stats(downloaded_at);
  `);

  const count = d.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (count === 0) {
    const insertCat = d.prepare('INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)');
    const cats = [
      ['开发工具', 'dev-tools', 1],
      ['效率工具', 'productivity', 2],
      ['设计工具', 'design', 3],
      ['系统工具', 'system', 4],
      ['音乐与视频', 'media', 5],
      ['阅读与写作', 'writing', 6],
      ['网络工具', 'network', 7],
      ['教育学习', 'education', 8],
      ['财务管理', 'finance', 9],
      ['其他', 'other', 10],
    ];
    const insertMany = d.transaction((items) => {
      for (const item of items) insertCat.run(...item);
    });
    insertMany(cats);
  }

  function columnExists(tableName, columnName) {
    const cols = d.prepare(`PRAGMA table_info(${tableName})`).all();
    return cols.some(c => c.name === columnName);
  }

  if (!columnExists('discussion_posts', 'is_hidden')) {
    d.exec(`ALTER TABLE discussion_posts ADD COLUMN is_hidden INTEGER DEFAULT 0`);
  }

  if (!columnExists('discussion_replies', 'is_hidden')) {
    d.exec(`ALTER TABLE discussion_replies ADD COLUMN is_hidden INTEGER DEFAULT 0`);
  }

  if (!columnExists('reports', 'resolution_note')) {
    d.exec(`ALTER TABLE reports ADD COLUMN resolution_note TEXT DEFAULT ''`);
  }

  if (!columnExists('reports', 'updated_at')) {
    d.exec(`ALTER TABLE reports ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`);
  }

  if (!columnExists('versions', 'status')) {
    d.exec(`ALTER TABLE versions ADD COLUMN status TEXT DEFAULT 'published' CHECK(status IN ('draft','pending_review','published'))`);
  }

  if (!columnExists('versions', 'limited_free_from')) {
    d.exec(`ALTER TABLE versions ADD COLUMN limited_free_from TEXT`);
  }

  if (!columnExists('versions', 'reviewed_by')) {
    d.exec(`ALTER TABLE versions ADD COLUMN reviewed_by INTEGER REFERENCES users(id)`);
  }

  if (!columnExists('versions', 'reviewed_at')) {
    d.exec(`ALTER TABLE versions ADD COLUMN reviewed_at TEXT`);
  }

  if (!columnExists('audit_logs', 'software_name')) {
    d.exec(`ALTER TABLE audit_logs ADD COLUMN software_name TEXT DEFAULT ''`);
  }

  if (!columnExists('audit_logs', 'submission_name')) {
    d.exec(`ALTER TABLE audit_logs ADD COLUMN submission_name TEXT DEFAULT ''`);
  }

  if (!columnExists('audit_logs', 'original_software_id')) {
    d.exec(`ALTER TABLE audit_logs ADD COLUMN original_software_id INTEGER`);
  }

  if (!columnExists('audit_logs', 'original_submission_id')) {
    d.exec(`ALTER TABLE audit_logs ADD COLUMN original_submission_id INTEGER`);
  }
}

module.exports = { getDb, initSchema };
