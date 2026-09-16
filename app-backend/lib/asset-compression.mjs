import { gzipSync } from "node:zlib";
export function compressAsset(file, extension, acceptEncoding) {
  const gzip = (acceptEncoding || "")
    .split(",")
    .some((part) => /^\s*gzip(?:\s*;|\s*$)/.test(part) && !/;\s*q=0(?:\.0*)?\s*$/.test(part));
  if (file.length > 1024 && /\.(js|css|html|svg)$/.test(extension) && gzip)
    return {
      body: gzipSync(file),
      headers: { "Content-Encoding": "gzip", Vary: "Accept-Encoding" },
    };
  return { body: file, headers: { Vary: "Accept-Encoding" } };
}
