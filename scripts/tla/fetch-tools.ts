import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as https from "node:https";

const DEFAULT_URL =
  process.env.TLA2TOOLS_URL ??
  "https://tla.msr-inria.inria.fr/tlatoolbox/dist/tla2tools.jar";

const OUT_PATH = resolve("tools/tla/tla2tools.jar");

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const fileStream = createWriteStream(dest);

    https
      .get(url, (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          fileStream.close();
          download(res.headers.location, dest)
            .then(resolvePromise)
            .catch(rejectPromise);
          return;
        }

        if (status < 200 || status >= 300) {
          fileStream.close();
          rejectPromise(new Error(`HTTP ${status} fetching ${url}`));
          return;
        }

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          resolvePromise();
        });
      })
      .on("error", (err) => {
        rejectPromise(err);
      });
  });
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");

  if (existsSync(OUT_PATH) && !force) {
    // eslint-disable-next-line no-console
    console.log(`tla2tools.jar already present at ${OUT_PATH}`);
    return;
  }

  ensureDir(OUT_PATH);
  // eslint-disable-next-line no-console
  console.log(`Downloading tla2tools.jar from ${DEFAULT_URL} → ${OUT_PATH}`);

  try {
    await download(DEFAULT_URL, OUT_PATH);
    // eslint-disable-next-line no-console
    console.log("Done.");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to download tla2tools.jar:", err);
    process.exitCode = 1;
  }
}

void main();
