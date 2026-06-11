const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { initSchema } = require('./db/index');
const { errorHandler } = require('./middleware/errorHandler');

const accountRoutes = require('./routes/account');
const softwareRoutes = require('./routes/software');
const submissionRoutes = require('./routes/submission');
const auditRoutes = require('./routes/audit');
const discussionRoutes = require('./routes/discussion');
const ratingRoutes = require('./routes/rating');
const downloadRoutes = require('./routes/download');
const recommendationRoutes = require('./routes/recommendation');
const collectionRoutes = require('./routes/collection');
const authorRoutes = require('./routes/author');

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(require('path').join(__dirname, '..', 'uploads')));

app.get('/api', (req, res) => {
  res.json({
    name: 'macOS Software Community API',
    version: '1.0.0',
    endpoints: {
      account: '/api/account',
      software: '/api/software',
      submission: '/api/submissions',
      audit: '/api/audit',
      discussion: '/api/discussion',
      rating: '/api/ratings',
      download: '/api/downloads',
      recommendation: '/api/recommendations',
      collection: '/api/collections',
      author: '/api/authors',
    },
  });
});

app.use('/api/account', accountRoutes);
app.use('/api/software', softwareRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/discussion', discussionRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/downloads', downloadRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/authors', authorRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use(errorHandler);

initSchema();

module.exports = app;
