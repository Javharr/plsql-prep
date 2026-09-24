import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    setHeaders(res, filePath) {
      // контент обновляется часто — не даём браузеру залипать на старой версии
      if (filePath.endsWith(".json") || filePath.endsWith(".js")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// одностраничное приложение: любой неизвестный путь отдаёт index.html
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`plsql-prep слушает порт ${PORT}`);
});
