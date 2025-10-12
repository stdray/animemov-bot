import { createWriteStream, unlink } from "fs";
import { promisify } from "util";
import path from "path";
import crypto from "crypto";
import { env } from "../config/env";

const unlinkAsync = promisify(unlink);

export class TempFileManager {
  createPath(extension: string) {
    const safeExtension = extension.startsWith(".") ? extension : `.${extension}`;
    const name = `${crypto.randomUUID()}${safeExtension}`;
    return path.join(env.tempDir, name);
  }

  async saveBuffer(filePath: string, buffer: ArrayBuffer) {
    await new Promise<void>((resolve, reject) => {
      const stream = createWriteStream(filePath);
      stream.on("error", reject);
      stream.on("finish", resolve);
      stream.end(Buffer.from(buffer));
    });
  }

  async cleanup(paths: string[]) {
    await Promise.allSettled(paths.map((p) => unlinkAsync(p)));
  }
}
