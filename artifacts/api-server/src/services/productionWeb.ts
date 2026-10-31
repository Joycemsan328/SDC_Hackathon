import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";

/** Mount after the API router: an API failure must never become an HTML response. */
export function serveProductionWeb(app: Express, publicDirectory: string) {
  const indexFile = path.join(publicDirectory, "index.html");
  if (!existsSync(indexFile)) {
    throw new Error("React production build is missing. Run pnpm run build:production before starting.");
  }
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found.", code: "NOT_FOUND" });
  });
  app.use("/assets", express.static(path.join(publicDirectory, "assets"), {
    immutable: true, maxAge: "1y", dotfiles: "deny", index: false,
  }));
  app.use(express.static(publicDirectory, {
    index: false, dotfiles: "deny", maxAge: 0,
    setHeaders(res) { res.setHeader("Cache-Control", "no-cache"); },
  }));
  app.use((req, res, next) => {
    // GET/HEAD browser navigations only. Missing JS/CSS must remain real 404s.
    if ((req.method !== "GET" && req.method !== "HEAD") || !req.accepts("html")
      || req.path === "/assets" || req.path.startsWith("/assets/")
      || req.path.split("/").some((segment) => segment.startsWith("."))
      || path.extname(req.path)) return next();
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(indexFile);
  });
  app.use((_req, res) => { res.status(404).json({ error: "Not found." }); });
}
