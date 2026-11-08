import { getRequestListener } from '@hono/node-server';

import app from '../src/app.js';

// Vercel Node.js serverless entry: adapts (req, res) to the Hono app.
// Every request is routed here (see vercel.json).
export default getRequestListener(app.fetch);
