import rateLimit from 'express-rate-limit';

// NOTE: apiLimiter fires before protect middleware, so req.user is not
// available here. We use IP-based limiting with generous limits so normal
// multi-user office use never triggers it. Only actual abuse (bots, scrapers)
// will hit these limits.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,                     // 2000 req / 15min per IP — covers busy office use
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' },
  skip: (req) => req.path === '/health',
});

// Auth endpoints — tighter limit to block brute-force, but raised from 20
// so dev/test login attempts don't block you during development.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Try again later.' },
});
