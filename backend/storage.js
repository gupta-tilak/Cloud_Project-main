// =============================================================
// Object storage abstraction
//   • S3 mode    — when S3_BUCKET is set (production / AWS demo)
//   • Local mode — JSON files under backend/data (offline demo)
// Both expose the same key-value API so server.js is storage-agnostic.
// =============================================================
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

function streamToString(streamBody) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const s = streamBody instanceof Readable ? streamBody : Readable.from(streamBody);
    s.on("data", (c) => chunks.push(Buffer.from(c)));
    s.on("error", reject);
    s.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function s3Store(bucket, region) {
  const s3 = new S3Client({ region });
  return {
    mode: `s3://${bucket} (${region})`,
    async putJSON(key, data) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: JSON.stringify(data, null, 2), ContentType: "application/json",
      }));
    },
    async getJSON(key, fallback = {}) {
      try {
        const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return JSON.parse(await streamToString(obj.Body));
      } catch {
        return fallback;
      }
    },
    async listKeys(prefix) {
      const keys = [];
      let token;
      do {
        const out = await s3.send(new ListObjectsV2Command({
          Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000,
        }));
        for (const obj of out.Contents ?? []) keys.push(obj.Key);
        token = out.IsTruncated ? out.NextContinuationToken : null;
      } while (token);
      return keys;
    },
  };
}

function localStore(root) {
  const file = (key) => path.join(root, ...key.split("/"));
  async function walk(dir, acc) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return acc; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p, acc);
      else acc.push(path.relative(root, p).split(path.sep).join("/"));
    }
    return acc;
  }
  return {
    mode: `local filesystem (${path.relative(process.cwd(), root) || root})`,
    async putJSON(key, data) {
      await fs.mkdir(path.dirname(file(key)), { recursive: true });
      await fs.writeFile(file(key), JSON.stringify(data, null, 2));
    },
    async getJSON(key, fallback = {}) {
      try {
        return JSON.parse(await fs.readFile(file(key), "utf8"));
      } catch {
        return fallback;
      }
    },
    async listKeys(prefix) {
      // walk from the deepest directory contained in the prefix
      const dirPart = prefix.endsWith("/") ? prefix : prefix.split("/").slice(0, -1).join("/") + "/";
      const keys = await walk(file(dirPart), []);
      return keys.filter((k) => k.startsWith(prefix));
    },
  };
}

export function createStore() {
  if (process.env.S3_BUCKET) return s3Store(process.env.S3_BUCKET, process.env.AWS_REGION || "ap-south-1");
  const here = path.dirname(fileURLToPath(import.meta.url));
  return localStore(path.join(here, "data"));
}
