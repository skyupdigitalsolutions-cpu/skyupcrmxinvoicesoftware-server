import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import { env } from './config/env.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/error.js';
import routes from './routes/index.js';

const app = express();

// Render (and most PaaS hosts) sit behind a reverse proxy, so the client IP
// arrives in X-Forwarded-For. Without this, express-rate-limit keys every
// request off the proxy's IP — throttling ALL tenants as one bucket — and
// emits ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. `1` = trust the single Render hop.
// It also lets req.secure / secure cookies work correctly behind the proxy.
app.set('trust proxy', 1);

const allowedOrigins = [
  env.clientUrl,
  /\.skyupcrmxinvoicesoftwareclient\.pages\.dev$/,
  'http://localhost:5173',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow non-browser requests
    const allowed = allowedOrigins.some((o) =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    if (allowed) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(helmet());                                   // secure HTTP headers
app.use(express.json({ limit: '1mb' }));             // body size cap
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(mongoSanitize());                            // strip $ / . from inputs (NoSQL injection)
app.use(hpp());                                      // HTTP param pollution
if (!env.isProd) app.use(morgan('dev'));
app.use('/api', apiLimiter);

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
