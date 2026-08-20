#!/usr/bin/env node
// Pre-flight checks for the extension: valid manifest, parseable scripts and
// no references to files that are missing from the repo.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const problems = [];
const fail = (msg) => problems.push(msg);

// ---- manifest.json ----
let manifest;
try {
  manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
} catch (err) {
  console.error(`manifest.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) fail(`manifest_version must be 3 (found ${manifest.manifest_version})`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || "")) {
  fail(`version "${manifest.version}" is not a valid Chrome extension version (e.g. 2.1 or 2.1.0)`);
}
if (!manifest.name) fail("manifest is missing a name");

// ---- files the manifest points at ----
const referenced = new Set();
const add = (v) => { if (typeof v === "string") referenced.add(v); };

add(manifest.background?.service_worker);
add(manifest.action?.default_popup);
Object.values(manifest.action?.default_icon ?? {}).forEach(add);
Object.values(manifest.icons ?? {}).forEach(add);
for (const cs of manifest.content_scripts ?? []) {
  (cs.js ?? []).forEach(add);
  (cs.css ?? []).forEach(add);
}
for (const war of manifest.web_accessible_resources ?? []) {
  (war.resources ?? []).forEach(add);
}

for (const file of referenced) {
  if (!existsSync(file)) fail(`manifest references "${file}", which does not exist`);
}

// ---- assets the popup pulls in ----
const popupFile = manifest.action?.default_popup;
if (popupFile && existsSync(popupFile)) {
  const html = readFileSync(popupFile, "utf8");
  const localRefs = [
    ...html.matchAll(/<script[^>]+src="([^"]+)"/g),
    ...html.matchAll(/<img[^>]+src="([^"]+)"/g),
    ...html.matchAll(/<link[^>]+href="([^"]+)"/g)
  ]
    .map((m) => m[1])
    .filter((src) => !/^(https?:)?\/\//.test(src) && !src.startsWith("data:"));

  for (const src of localRefs) {
    if (!existsSync(src)) fail(`${popupFile} references "${src}", which does not exist`);
    referenced.add(src);
  }
}

// ---- every shipped script must parse ----
for (const file of [...referenced].filter((f) => f.endsWith(".js"))) {
  if (!existsSync(file)) continue;
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    fail(`${file} has a syntax error:\n${err.stderr?.toString().trim()}`);
  }
}

// ---- report ----
if (problems.length > 0) {
  console.error("Validation failed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}

console.log(`OK: ${manifest.name} v${manifest.version} — ${referenced.size} referenced files checked.`);
