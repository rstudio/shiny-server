#!/usr/bin/env node

// Lists every memory-bank document with its frontmatter title and description.
// Deliberately dependency-free: this repo has no YAML parser, and the
// frontmatter we care about is only a couple of scalar keys.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

// Minimal frontmatter reader: top-level `key: value` pairs plus `|`/`>` block
// scalars. Anything more exotic is ignored rather than guessed at.
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const meta = {};
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
    if (!kv) continue;

    const key = kv[1];
    const rest = kv[2].trim();

    if (rest === "|" || rest === ">" || /^[|>][-+]?\d*$/.test(rest)) {
      const folded = rest[0] === ">";
      const block = [];
      while (i + 1 < lines.length && /^(\s*$|[ \t]+\S)/.test(lines[i + 1])) {
        block.push(lines[++i].replace(/^\s{1,4}/, ""));
      }
      meta[key] = folded
        ? block.join(" ").replace(/\s+/g, " ").trim()
        : block.join("\n").trim();
    } else {
      meta[key] = unquote(rest);
    }
  }

  return meta;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const memoryBank = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "..", "..", "..", "..", "memory-bank");

if (!fs.existsSync(memoryBank) || !fs.statSync(memoryBank).isDirectory()) {
  console.error(`Error: ${memoryBank} is not a directory`);
  process.exit(1);
}

const files = fs
  .readdirSync(memoryBank)
  .filter((f) => f.endsWith(".md"))
  .sort();

for (const file of files) {
  const content = fs.readFileSync(path.join(memoryBank, file), "utf8");
  const meta = parseFrontmatter(content);
  const title = typeof meta.title === "string" ? meta.title : "";
  const description = typeof meta.description === "string" ? meta.description : "";

  if (title) {
    console.log(`## ${title} (memory-bank/${file})`);
  } else {
    console.log(`## memory-bank/${file}`);
  }

  if (description) {
    console.log(description);
  }

  console.log();
}
