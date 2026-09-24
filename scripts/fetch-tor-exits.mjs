#!/usr/bin/env node
/**
 * Bakes the Tor exit node list (check.torproject.org/torbulkexitlist) into
 * src/net/tor-exits.json at build time. The Tor Project endpoints send no
 * CORS headers, so a runtime fetch is impossible — the list must ship with
 * the bundle. Refreshed on every `npm run build`; between builds, brand-new
 * exits are unknown (a Tor user on a very new exit gets blocked until the
 * next deploy — accepted tradeoff, see README network privacy).
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EXIT_LIST_URL = 'https://check.torproject.org/torbulkexitlist';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'net', 'tor-exits.json');

const res = await fetch(EXIT_LIST_URL);
if (!res.ok) {
  throw new Error(`fetching Tor exit list failed: ${res.status}`);
}

const body = await res.text();
const exits = [...new Set(body.split('\n').map((line) => line.trim()).filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)))];

await writeFile(OUT, `${JSON.stringify(exits, null, 0)}\n`);
console.log(`baked ${exits.length} Tor exit IPs`);
