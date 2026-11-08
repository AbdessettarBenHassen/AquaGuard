import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

// Applies schema.sql. Idempotent: every CREATE uses IF NOT EXISTS.
const sql = neon(process.env.DATABASE_URL!);

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const statements = schema
  .split(/;\s*$/m)
  .map((s) => s.replace(/--.*$/gm, '').trim())
  .filter(Boolean);
for (const stmt of statements) await sql.query(stmt);

const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`;
console.log('Schema applied. Tables:', tables.map((t) => t.table_name).join(', '));
