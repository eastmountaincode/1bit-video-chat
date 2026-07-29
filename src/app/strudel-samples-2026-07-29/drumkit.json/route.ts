import drumkitManifest from "@/lib/strudel-samples/uzu-drumkit.json";
import { createStrudelSampleManifestResponse } from "@/lib/strudel-sample-manifest-response";

export const dynamic = "force-static";

export function GET() {
  return createStrudelSampleManifestResponse(drumkitManifest);
}
