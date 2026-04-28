import { createReadStream } from "fs";
import { existsSync, statSync } from "fs";
import path from "path";

export const runtime = "nodejs";

// Temporary dev-only route for testing with a local video file.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path");

    if (!filePath || !existsSync(filePath)) {
      return new Response("File not found: " + filePath, { status: 404 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === ".mov" ? "video/quicktime" :
      ext === ".mp4" ? "video/mp4" :
      "video/webm";

    const { size } = statSync(filePath);

    // Stream the file rather than buffering 36MB into memory
    const nodeStream = createReadStream(filePath);
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on("data", (chunk) => controller.enqueue(chunk));
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (err) => controller.error(err));
      },
    });

    return new Response(webStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
      },
    });
  } catch (err) {
    console.error("[test-video]", err);
    return new Response(String(err), { status: 500 });
  }
}
