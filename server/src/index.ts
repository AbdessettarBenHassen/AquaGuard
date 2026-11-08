import 'dotenv/config';
import { serve } from '@hono/node-server';

import app from './app.js';

// Local development server. In production the same app runs on Vercel (api/index.ts).
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: '::' }, () => console.log(`AquaGuard API listening on :${port}`));
