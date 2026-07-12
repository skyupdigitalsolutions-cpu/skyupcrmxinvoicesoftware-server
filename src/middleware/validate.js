import { ApiError } from '../utils/ApiError.js';

// Validates req.body/params/query against a Yup schema object { body, params, query }.
// Mirrors the previous Zod middleware:
//   • strips unknown keys and applies defaults/coercions (cast with stripUnknown)
//   • reassigns the cleaned value back onto req
//   • on failure → ApiError(422, 'Validation failed', [{ path, message }])
const CAST_OPTS = { stripUnknown: true };
const VALIDATE_OPTS = { abortEarly: false, stripUnknown: true };

const run = async (schema, value) => {
  // validate() returns the coerced + defaulted + stripped object.
  return schema.validate(value, VALIDATE_OPTS);
};

export const validate = (schema) => async (req, _res, next) => {
  try {
    if (schema.body)   req.body   = await run(schema.body, req.body ?? {});
    if (schema.params) req.params = await run(schema.params, req.params ?? {});
    if (schema.query)  req.query  = await run(schema.query, req.query ?? {});
    next();
  } catch (err) {
    // Yup ValidationError: err.inner holds per-field errors when abortEarly:false.
    const details = (err.inner && err.inner.length
      ? err.inner.map((e) => ({ path: e.path || '', message: e.message }))
      : [{ path: err.path || '', message: err.message }]
    );
    next(new ApiError(422, 'Validation failed', details));
  }
};
