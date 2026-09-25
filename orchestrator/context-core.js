"use strict";

const path = require("node:path");

const GENERIC_STOP = new Set([
  "the","and","for","with","from","this","that","must","should","only",
  "existing","change","work","file","files","code","test","tests","run","add","use",
  "する","して","した","します","できる","できない","こと","もの","ため","よう",
  "これ","それ","ここ","そこ","ある","いる","なる","ない","あり","なし",
  "修正","変更","追加","対応","確認","実装","機能","画面","部分","状態","現在"
]);

const MANIFEST_RE = /(^|\/)(package\.json|tsconfig[^/]*\.json|jsconfig\.json|pyproject\.toml|requirements[^/]*\.txt|cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|composer\.json)$/i;
const TEST_RE = /(^|\/)(test|tests|__tests__)(\/|$)|\.(?:test|spec)\.[^.\/]+$/i;
const SOURCE_RE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|cs|cpp|cc|c|h|hpp|rb|php|swift|vue|svelte)$/i;
const SOURCE_EXT_RE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|cs|cpp|cc|c|h|hpp|rb|php|swift|vue|svelte)$/i;

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .toLowerCase();
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function segmentWords(text) {
  const normalized = normalizeText(text);
  const out = [];

  if (typeof Intl?.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
    const parts = [...segmenter.segment(normalized)]
      .filter(part => part.isWordLike)
      .map(part => ({
        token: part.segment.trim(),
        index: part.index
      }))
      .filter(part => part.token);

    for (const part of parts) {
      if (part.token.length >= 2 && !GENERIC_STOP.has(part.token)) {
        out.push(part.token);
      }
    }

    for (let i = 0; i + 1 < parts.length; i++) {
      const a = parts[i];
      const b = parts[i + 1];
      if (a.index + a.token.length !== b.index) continue;
      if (a.token.length < 2 || b.token.length < 2) continue;
      const joined = a.token + b.token;
      if (joined.length >= 3 && joined.length <= 20 && !GENERIC_STOP.has(joined)) {
        out.push(joined);
      }
    }
  }

  for (const token of normalized.match(/[a-z_][a-z0-9_.:@/-]{1,}/g) || []) {
    if (token.length < 2 || GENERIC_STOP.has(token)) continue;
    out.push(token);
  }

  if (!out.length) {
    for (const token of normalized.match(/[\p{L}\p{N}_-]{2,}/gu) || []) {
      if (!GENERIC_STOP.has(token)) out.push(token);
    }
  }

  return uniq(out).slice(0, 96);
}

function extractPathHints(text) {
  const normalized = normalizeText(text).replaceAll("\\", "/");
  const matches = normalized.match(/(?:[a-z0-9_.@-]+\/)*[a-z0-9_.@-]+\.(?:[cm]?[jt]sx?|json|md|py|go|rs|java|kt|kts|cs|cpp|cc|c|h|hpp|rb|php|swift|vue|svelte|toml|ya?ml|css|scss|html)/g) || [];
  return uniq(matches).slice(0, 32);
}

function buildQueryProfile(task) {
  const normalized = normalizeText(task);
  const terms = segmentWords(normalized);
  const pathHints = extractPathHints(normalized);
  const phrases = uniq(
    normalized
      .split(/[\n。！？!?、,;；:：()（）\[\]{}「」『』<>\s]+/u)
      .map(x => x.trim())
      .filter(x => x.length >= 3 && x.length <= 80 && !GENERIC_STOP.has(x))
  ).slice(0, 32);

  return { normalized, terms, pathHints, phrases };
}

function occurrenceScore(haystack, needle, weight, cap = 3) {
  if (!needle || !haystack.includes(needle)) return 0;
  let count = 0;
  let from = 0;
  while (count < cap) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    count++;
    from = index + Math.max(needle.length, 1);
  }
  return count * weight;
}

function scoreCandidate(rel, content, profile) {
  const pathText = normalizeText(rel).replaceAll("\\", "/");
  const base = pathText.split("/").pop() || pathText;
  const body = normalizeText(content).slice(0, 70000);
  let score = 0;

  for (const hint of profile.pathHints || []) {
    const h = hint.replaceAll("\\", "/");
    if (pathText === h || pathText.endsWith("/" + h)) score += 100;
    else if (pathText.includes(h)) score += 60;
  }

  for (const term of profile.terms || []) {
    if (base.includes(term)) score += 18;
    else if (pathText.includes(term)) score += 12;
    score += occurrenceScore(body, term, 4, 3);
  }

  for (const phrase of profile.phrases || []) {
    if (pathText.includes(phrase)) score += 20;
    score += occurrenceScore(body, phrase, 6, 2);
  }

  if (MANIFEST_RE.test(pathText)) score += 4;
  if (TEST_RE.test(pathText)) score += 2;
  if (SOURCE_RE.test(pathText)) score += 1;

  return score;
}

function extractSpecifiers(content) {
  const text = String(content ?? "").slice(0, 100000);
  const specs = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null && specs.length < 128) {
      specs.push(match[1]);
    }
  }
  return uniq(specs);
}

function canonicalModuleKey(rel) {
  const normalized = String(rel || "").replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized.replace(SOURCE_EXT_RE, "").replace(/\/index$/i, "");
}

function applyRelationBoost(candidates, seedLimit = 6) {
  const rankedSeeds = [...candidates]
    .filter(file => file.score > 0)
    .sort((a, b) => b.score - a.score || a.size - b.size)
    .slice(0, seedLimit);

  if (!rankedSeeds.length) return candidates;

  const byKey = new Map();
  for (const file of candidates) {
    byKey.set(canonicalModuleKey(file.rel), file);
  }

  for (const seed of rankedSeeds) {
    const seedDir = path.posix.dirname(String(seed.rel).replaceAll("\\", "/"));
    for (const specifier of extractSpecifiers(seed.fullContent ?? seed.content)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = canonicalModuleKey(path.posix.normalize(path.posix.join(seedDir, specifier)));
      const target = byKey.get(resolved);
      if (target && target !== seed) target.score += 8;
    }
  }

  return candidates;
}

function makeExcerpt(content, profile, limit = 1800) {
  const source = String(content ?? "").replace(/\r\n/g, "\n");
  if (source.length <= limit) return source;

  const lower = normalizeText(source);
  const needles = uniq([...(profile.pathHints || []), ...(profile.terms || []), ...(profile.phrases || [])])
    .filter(x => x.length >= 2)
    .slice(0, 32);

  const hits = [];
  for (const needle of needles) {
    const index = lower.indexOf(normalizeText(needle));
    if (index >= 0) hits.push(index);
    if (hits.length >= 4) break;
  }

  if (!hits.length) return source.slice(0, limit);

  const windows = hits
    .sort((a, b) => a - b)
    .map(index => [Math.max(0, index - 260), Math.min(source.length, index + 520)]);

  const merged = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window[0] <= last[1] + 80) last[1] = Math.max(last[1], window[1]);
    else merged.push(window);
  }

  let out = merged.map(([a, b]) => source.slice(a, b)).join("\n[...snip...]\n");
  if (out.length > limit) out = out.slice(0, limit);
  return out;
}

function selectCandidates(candidates, options = {}) {
  const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : 8;
  const maxChars = Number.isInteger(options.maxChars) ? options.maxChars : 6000;

  const ranked = [...candidates].sort(
    (a, b) => b.score - a.score || a.size - b.size || a.rel.localeCompare(b.rel)
  );

  const selected = [];
  let chars = 0;

  for (const file of ranked) {
    if (selected.length >= maxFiles) break;
    const content = file.contextContent ?? file.content;
    const add = content.length + file.rel.length + 100;
    if (chars + add > maxChars) continue;
    selected.push({ ...file, content });
    chars += add;
  }

  return selected;
}

module.exports = {
  buildQueryProfile,
  segmentWords,
  extractPathHints,
  scoreCandidate,
  extractSpecifiers,
  applyRelationBoost,
  makeExcerpt,
  selectCandidates
};