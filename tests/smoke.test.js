import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(join(root, file), "utf8");

test("application JavaScript parses", () => {
  for (const file of ["app.js", "service-worker.js"]) {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("manifest and service worker reference existing assets", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.lang, "he");
  assert.equal(manifest.dir, "rtl");

  const worker = read("service-worker.js");
  const cachedAssets = [...worker.matchAll(/^\s*"([^"]+)"[,]?$/gm)].map(match => match[1]);
  assert.ok(cachedAssets.length >= 6, "expected core PWA assets in cache list");

  for (const asset of cachedAssets) {
    const filePath = asset.split("?", 1)[0];
    assert.ok(existsSync(join(root, filePath)), `missing cached asset: ${asset}`);
  }

  for (const icon of manifest.icons) {
    assert.ok(existsSync(join(root, icon.src)), `missing manifest icon: ${icon.src}`);
  }
});

test("inline App handlers are exposed by the public interface", () => {
  const appSource = read("app.js");
  const markup = `${read("index.html")}\n${appSource}`;
  const handlers = new Set([...markup.matchAll(/App\.([A-Za-z_$][\w$]*)/g)].map(match => match[1]));
  const publicBlock = appSource.slice(appSource.lastIndexOf("return {"));

  for (const handler of handlers) {
    assert.match(publicBlock, new RegExp(`\\b${handler}\\b`), `${handler} is not publicly exposed`);
  }
});
