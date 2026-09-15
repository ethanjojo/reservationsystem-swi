import express from "express";

const app = express();
app.disable("x-powered-by");
app.get("/health", (_request, response) => {
  response.json({ status: "ok", service: "bookerdoc-api" });
});

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, "127.0.0.1", () => {
  console.info(`BookerDoc API: http://localhost:${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close());
}
