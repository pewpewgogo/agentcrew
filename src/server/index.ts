import { createPool } from '../shared/db.js';
import { buildApp } from './app.js';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }
const port = Number(process.env.PORT ?? 3000);

const pool = createPool(url);
const app = await buildApp(pool);
await app.listen({ port, host: '0.0.0.0' });
console.log(`contextsync listening on :${port}`);
