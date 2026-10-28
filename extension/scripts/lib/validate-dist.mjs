// Checks a built extension folder against what the Chrome Web Store and this project require, and returns the
// problems found (an empty list means the package is good to zip). Used by the packaging script and by tests.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DESCRIPTION_CHARS = 132;
const ICON_SIZES = [16, 48, 128];

/** Every file under a folder, as paths relative to it with "/" separators. */
export function listFiles(root, dir = root) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(root, full));
    else out.push(relative(root, full).split("\\").join("/"));
  }
  return out.sort();
}

/** Width and height of a PNG from its header, or null when it is not one. */
export function pngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const FORBIDDEN_FILES = [/\.map$/, /(^|\/)node_modules\//, /\.test\./, /(^|\/)test\//, /\.ts$/, /(^|\/)\.env/, /\.md$/];
const FORBIDDEN_CODE = [
  [/\beval\s*\(/, "eval()"],
  [/\bnew\s+Function\s*\(/, "new Function()"],
  [/\.innerHTML\s*=/, "an innerHTML assignment"],
  [/\.insertAdjacentHTML\s*\(/, "insertAdjacentHTML()"],
  [/document\.write\s*\(/, "document.write()"],
];

export function validateDist(dist, packageVersion) {
  const problems = [];
  const problem = (text) => problems.push(text);
  let files;
  try {
    files = listFiles(dist);
  } catch {
    return [`The build folder ${dist} does not exist. Run npm run build first.`];
  }
  const has = (path) => files.includes(path);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf-8"));
  } catch {
    return ["manifest.json is missing or is not valid JSON."];
  }

  if (manifest.manifest_version !== 3) problem("manifest_version must be 3.");
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? ""))
    problem(`version "${manifest.version}" is not a Chrome version (1 to 4 dot-separated numbers).`);
  if (packageVersion && manifest.version !== packageVersion)
    problem(`manifest version ${manifest.version} differs from package.json ${packageVersion}.`);

  // Names and descriptions come from the locale files, and the description has a store limit.
  const localeFile = `_locales/${manifest.default_locale ?? "en"}/messages.json`;
  if (!has(localeFile)) problem(`${localeFile} is missing.`);
  else {
    const messages = JSON.parse(readFileSync(join(dist, localeFile), "utf-8"));
    for (const key of ["extName", "extDescription"]) {
      if (typeof messages[key]?.message !== "string" || !messages[key].message)
        problem(`${localeFile} has no "${key}" message.`);
    }
    const description = messages["extDescription"]?.message ?? "";
    if (description.length > MAX_DESCRIPTION_CHARS)
      problem(`The description is ${description.length} characters; the store allows ${MAX_DESCRIPTION_CHARS}.`);
    for (const field of ["name", "description"]) {
      const match = /^__MSG_(\w+)__$/.exec(manifest[field] ?? "");
      if (match && !messages[match[1]]) problem(`manifest ${field} uses a message "${match[1]}" that is not defined.`);
    }
  }

  // Icons: present, real PNGs, the size their key says.
  for (const size of ICON_SIZES) {
    const path = manifest.icons?.[String(size)];
    if (!path) {
      problem(`No ${size}px icon in the manifest.`);
      continue;
    }
    if (!has(path)) {
      problem(`Icon ${path} is missing.`);
      continue;
    }
    const dimensions = pngSize(readFileSync(join(dist, path)));
    if (!dimensions) problem(`Icon ${path} is not a PNG.`);
    else if (dimensions.width !== size || dimensions.height !== size)
      problem(`Icon ${path} is ${dimensions.width}x${dimensions.height}, not ${size}x${size}.`);
  }

  // Everything the manifest points at must be in the package.
  const referenced = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...(manifest.content_scripts ?? []).flatMap((script) => [...(script.js ?? []), ...(script.css ?? [])]),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ].filter(Boolean);
  for (const path of referenced)
    if (!has(path)) problem(`The manifest refers to ${path}, which is not in the package.`);

  // Nothing that should not ship, nothing the store forbids.
  for (const file of files) {
    for (const pattern of FORBIDDEN_FILES) if (pattern.test(file)) problem(`${file} should not be in the package.`);
    if (file.endsWith(".js")) {
      const code = readFileSync(join(dist, file), "utf-8");
      for (const [pattern, what] of FORBIDDEN_CODE) if (pattern.test(code)) problem(`${file} contains ${what}.`);
      if (code.trim() === "") problem(`${file} is empty.`);
    }
    if (file.endsWith(".html")) {
      const html = readFileSync(join(dist, file), "utf-8");
      if (/<script[^>]+src\s*=\s*["']?(https?:)?\/\//i.test(html))
        problem(`${file} loads a script from a remote address.`);
      if (/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(html)) problem(`${file} has an inline script.`);
    }
  }

  const total = files.reduce((sum, file) => sum + statSync(join(dist, file)).size, 0);
  if (total > MAX_PACKAGE_BYTES) problem(`The package is ${total} bytes; the limit here is ${MAX_PACKAGE_BYTES}.`);
  return problems;
}
