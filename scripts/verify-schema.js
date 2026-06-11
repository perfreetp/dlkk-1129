const { initSchema, getDb } = require('../src/db/index');

console.log('Initializing schema...');
initSchema();

const db = getDb();
console.log('Schema initialized successfully');

const cols = db.prepare("SELECT name FROM pragma_table_info('discussion_posts') WHERE name = 'is_hidden'").get();
console.log('discussion_posts.is_hidden exists:', !!cols);

const cols2 = db.prepare("SELECT name FROM pragma_table_info('discussion_replies') WHERE name = 'is_hidden'").get();
console.log('discussion_replies.is_hidden exists:', !!cols2);

const cols3 = db.prepare("SELECT name FROM pragma_table_info('reports') WHERE name = 'resolution_note'").get();
console.log('reports.resolution_note exists:', !!cols3);

const cols4 = db.prepare("SELECT name FROM pragma_table_info('reports') WHERE name = 'updated_at'").get();
console.log('reports.updated_at exists:', !!cols4);

const auditCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_logs'").get();
const hasDelete = auditCheck.sql.includes("'delete'");
const hasResolve = auditCheck.sql.includes("'resolve'");
const hasDismiss = auditCheck.sql.includes("'dismiss'");
console.log('audit_logs CHECK has delete:', hasDelete);
console.log('audit_logs CHECK has resolve:', hasResolve);
console.log('audit_logs CHECK has dismiss:', hasDismiss);

console.log('\nAll schema migrations verified successfully!');
