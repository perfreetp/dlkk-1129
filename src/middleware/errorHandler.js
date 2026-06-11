const STATUS_MAP = {
  ValidationError: 400,
  UnauthorizedError: 401,
  ForbiddenError: 403,
  NotFoundError: 404,
};

function errorHandler(err, req, res, next) {
  console.error(err);

  const status = err.status || STATUS_MAP[err.name] || 500;
  const message = status === 500 && !err.status ? 'Internal Server Error' : err.message;

  res.status(status).json({ error: message });
}

function createError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { errorHandler, createError, asyncHandler };
