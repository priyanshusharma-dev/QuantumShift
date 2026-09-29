export const httpError = (status, message, details) => Object.assign(new Error(message), { status, details });

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
