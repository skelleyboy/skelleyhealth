// Serves the encrypted dashboard payload the Mac sync uploads. The data is AES-encrypted on your
// Mac before upload, so this endpoint only ever returns ciphertext.
import { getStore } from "@netlify/blobs";

export default async () => {
  const payload = await getStore("noop").get("data");
  if (!payload) return new Response(JSON.stringify({ error: "No data synced yet" }), { status: 404, headers: { "content-type": "application/json" } });
  return new Response(payload, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};

export const config = { path: "/api/data" };
