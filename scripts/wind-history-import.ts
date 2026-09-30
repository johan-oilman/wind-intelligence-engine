// Local archive import: personal mailbox exports must remain outside the public Git repository.
import { readFileSync } from "node:fs";
import { closeDb } from "@aihot/backend/db";
import { importWindHistory } from "@aihot/backend/projects/history";
const filename = process.argv[2];
if (!filename || !process.argv.includes("--confirm-import")) throw new Error("Usage: node --env-file=.env scripts/wind-history-import.ts path/to/archive.json --confirm-import");
try { console.log(JSON.stringify(await importWindHistory(JSON.parse(readFileSync(filename, "utf8")), "local:history-migration"))); }
finally { await closeDb(); }
