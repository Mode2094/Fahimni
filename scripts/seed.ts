import { closeDb, getDb } from '../db/index';
import { seedCatalog } from '../db/seed';

async function main(): Promise<void> {
  const summary = await seedCatalog(getDb());
  console.log(`Seed complete: ${summary.grades} grades, ${summary.fields} academic fields, ${summary.subjects} subjects.`);
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
