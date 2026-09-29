// `npm run seed` — wipes and re-seeds the demo database.
import { initDb, closeDb } from './index.js';
import { resetAll, seedIfEmpty } from './seed.js';

await initDb();
await resetAll();
await seedIfEmpty();
await closeDb();
console.log('[seed] database reset and re-seeded');
