#!/usr/bin/env node
/**
 * Fails the build if a secret, or the test-mode flag, could reach a browser.
 *
 * Next.js inlines any NEXT_PUBLIC_* variable into the client bundle. One of this
 * project's variables is a Supabase service-role key, so the rule is simple:
 * nothing sensitive gets that prefix, and this check proves it after the fact
 * by reading what was actually emitted.
 *
 * Run it after `next build`, against .next.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/**
 * Only what a browser can actually receive:
 *   .next/static           client bundles
 *   .next/server/app/*.html  prerendered markup
 * Server-side chunks are not scanned — they are meant to hold the credentials,
 * and their comments mention the scopes this check is looking for.
 */
const CLIENT_DIR = path.join(ROOT, ".next", "static");
const PRERENDER_DIR = path.join(ROOT, ".next", "server", "app");

const failures = [];

/* 1. No sensitive NEXT_PUBLIC_* names, wherever they are defined. */
const FORBIDDEN_PUBLIC = /^NEXT_PUBLIC_.*(SUPABASE|SECRET|KEY|TOKEN|PASSWORD|SERVICE|RESEND)/i;
for (const name of Object.keys(process.env)) {
  if (FORBIDDEN_PUBLIC.test(name)) {
    failures.push(`${name} is NEXT_PUBLIC_ and looks like a credential — Next inlines it.`);
  }
}

/* 2. The build output must not contain any live credential value. */
const NEEDLES = [
  ["SUPABASE_SERVICE_ROLE_KEY value", process.env.SUPABASE_SERVICE_ROLE_KEY],
  ["SUPABASE_ANON_KEY value", process.env.SUPABASE_ANON_KEY],
  ["RESEND_API_KEY value", process.env.RESEND_API_KEY],
].filter(([, v]) => typeof v === "string" && v.length >= 12);

/* 3. Patterns that should never appear in anything shipped to a browser. */
const PATTERNS = [
  [/service_role/, "the literal string service_role"],
  [/SUPABASE_SERVICE_ROLE_KEY/, "the service-role variable name"],
  [/SUPABASE_ANON_KEY/, "the anon key variable name"],
  [/re_[A-Za-z0-9]{20,}/, "something shaped like a Resend API key"],
];

function walk(dir, match) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full, match));
    else if (match.test(entry)) out.push(full);
  }
  return out;
}

const files = [
  ...walk(CLIENT_DIR, /\.(js|mjs|cjs|json|txt|html)$/),
  ...walk(PRERENDER_DIR, /\.html$/),
];

if (files.length === 0) {
  console.error("check:secrets — no build output found. Run `next build` first.");
  process.exit(1);
}

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);

  for (const [label, value] of NEEDLES) {
    if (text.includes(value)) failures.push(`${rel} contains the ${label}`);
  }
  for (const [pattern, label] of PATTERNS) {
    if (pattern.test(text)) failures.push(`${rel} contains ${label}`);
  }
}

/* 4. Test mode must never be baked into a production build. */
if (process.env.E2E_TEST_MODE === "1" && process.env.VERCEL_ENV === "production") {
  failures.push("E2E_TEST_MODE=1 in a production build — the session seeder would be live.");
}

if (failures.length > 0) {
  console.error(`check:secrets — ${failures.length} problem(s):`);
  for (const f of [...new Set(failures)]) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log(`check:secrets — clean (${files.length} files scanned)`);
