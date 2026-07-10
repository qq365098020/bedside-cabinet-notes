import { copyFile, mkdir, writeFile } from "node:fs/promises";

await mkdir("dist/assets", { recursive: true });
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });

await Promise.all([
  copyFile("sw.js", "dist/sw.js"),
  copyFile("manifest.json", "dist/manifest.json"),
  copyFile("version.json", "dist/version.json"),
  copyFile("assets/icon.svg", "dist/assets/icon.svg"),
  copyFile(".openai/hosting.json", "dist/.openai/hosting.json")
]);

await writeFile(
  "dist/server/index.js",
  `export default {
  async fetch(request, env) {
    if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return new Response("Sites static asset binding is not available.", { status: 500 });
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    const accept = request.headers.get("accept") || "";
    if (!accept.includes("text/html")) return response;

    const url = new URL(request.url);
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  }
};
`
);
