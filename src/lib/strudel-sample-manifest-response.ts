export function createStrudelSampleManifestResponse(manifest: unknown) {
  return Response.json(manifest, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
