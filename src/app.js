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

app.use(helmet());                                   // secure HTTP headers
app.use(cors({ origin: env.clientUrl, credentials: true }));
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
