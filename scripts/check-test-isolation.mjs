#!/usr/bin/env node
/**
 * The fixture stores are files. The suite is fully parallel. This checks the
 * two facts have been reconciled.
 *
 * Two ways they come apart, both found by things failing somewhere they had no
 * business failing:
 *
 *   1. A spec with two `test.describe.serial` blocks that both reset a store.
 *      `serial` orders the tests inside one block and says nothing about two
 *      blocks running beside each other, so one block's reset lands between
 *      another's save and its reload. It surfaced once as a sort-code bug in
 *      My Profile and once as an admin tile that would not disappear.
 *
 *   2. Two different specs resetting the same store. Same failure, further
 *      apart, and no amount of `serial` inside either file helps.
 *
 * WHAT WOULD HAVE TO BE TRUE FOR THIS TO PASS WRONGLY (rule 12). A spec would
 * have to reset a store by some route other than `resetStores` — a raw
 * `page.request.post` to the seeder, say. That is why the raw call is looked
 * for too, and reported as unreadable rather than ignored: this check can say
 * "I cannot tell", and it does, loudly. It cannot see a spec that writes to
 * another spec's data without resetting anything, which is a different bug and
 * one the stores' own `describe.serial` conventions are for.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIR = "tests";
const problems = [];
/** store name -> the specs that reset it. */
const byStore = new Map();

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".spec.ts"))) {
  const src = readFileSync(path.join(DIR, file), "utf8");

  const serialBlocks = (src.match(/test\.describe\.serial\s*\(/g) ?? []).length;
  const fileSerial = /describe\.configure\s*\(\s*\{[^}]*mode:\s*["']serial["']/.test(src);
  const resets = [...src.matchAll(/resetStores\s*\(\s*page\s*,([^)]*)\)/g)].flatMap((m) =>
    [...m[1].matchAll(/["']([^"']+)["']/g)].map((s) => s[1]),
  );
  const rawSeeder = /request\.post\(\s*["'`][^"'`]*\/api\/test\/session\?reset/.test(src);

  if (rawSeeder) {
    problems.push(
      `${file}: resets a store by posting to the seeder directly. ` +
        `Use resetStores(page, ...) so this check can see what it touches.`,
    );
  }

  if (resets.length > 0 && serialBlocks > 1 && !fileSerial) {
    problems.push(
      `${file}: ${serialBlocks} serial blocks reset ${[...new Set(resets)].join(", ")}, ` +
        `but the file is not serial. Two serial blocks still run beside each other — ` +
        `add test.describe.configure({ mode: "serial" }) at the top.`,
    );
  }

  for (const store of new Set(resets)) {
    if (!byStore.has(store)) byStore.set(store, new Set());
    byStore.get(store).add(file);
  }
}

for (const [store, files] of byStore) {
  if (files.size > 1) {
    problems.push(
      `the "${store}" store is reset by ${[...files].join(" and ")}. ` +
        `Two specs resetting one file will interleave whatever either does about ordering.`,
    );
  }
}

if (problems.length > 0) {
  console.error("Test isolation:\n");
  for (const p of problems) console.error("  ✗ " + p + "\n");
  process.exit(1);
}

console.log(`Test isolation: ${byStore.size} fixture stores, each reset by one spec.`);
