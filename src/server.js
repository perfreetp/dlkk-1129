const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`macOS Software Community API running on http://localhost:${PORT}`);
  console.log(`API docs: http://localhost:${PORT}/api`);
});
