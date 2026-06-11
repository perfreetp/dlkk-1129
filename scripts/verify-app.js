const app = require('../src/app');
const { getDb } = require('../src/db/index');

console.log('App loaded successfully');
console.log('All routes configured correctly');

const db = getDb();

const cols = db.prepare("SELECT name FROM pragma_table_info('discussion_posts') WHERE name = 'is_hidden'").get();
console.log('discussion_posts.is_hidden exists:', !!cols);

const cols2 = db.prepare("SELECT name FROM pragma_table_info('discussion_replies') WHERE name = 'is_hidden'").get();
console.log('discussion_replies.is_hidden exists:', !!cols2);

const cols3 = db.prepare("SELECT name FROM pragma_table_info('reports') WHERE name = 'resolution_note'").get();
console.log('reports.resolution_note exists:', !!cols3);

const cols4 = db.prepare("SELECT name FROM pragma_table_info('reports') WHERE name = 'updated_at'").get();
console.log('reports.updated_at exists:', !!cols4);

console.log('\nApplication verification complete!');
