import { mkdir, readFile, writeFile } from "node:fs/promises";

const files = [
  ["index.html", "text/html; charset=utf-8"],
  ["styles.css", "text/css; charset=utf-8"],
  ["app.js", "text/javascript; charset=utf-8"],
  ["data.json", "application/json; charset=utf-8"],
];

const assets = {};
for (const [path, contentType] of files) {
  assets[`/${path}`] = {
    body: await readFile(path, "utf8"),
    contentType,
  };
}

const worker = `const ASSETS = ${JSON.stringify(assets)};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const asset = ASSETS[path] || (path.includes(".") ? null : ASSETS["/index.html"]);

    if (!asset) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers({
      "content-type": asset.contentType,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "cache-control": path === "/data.json" ? "no-cache" : "public, max-age=300",
    });
    return new Response(asset.body, { status: 200, headers });
  },
};
`;

await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await writeFile("dist/server/index.js", worker, "utf8");
await writeFile("dist/.openai/hosting.json", await readFile(".openai/hosting.json", "utf8"), "utf8");
console.log("Built dist/server/index.js");

