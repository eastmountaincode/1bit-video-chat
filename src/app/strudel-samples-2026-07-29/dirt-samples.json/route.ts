import dirtSamplesManifest from "@/lib/strudel-samples/dirt-samples.json";
import { createStrudelSampleManifestResponse } from "@/lib/strudel-sample-manifest-response";

export const dynamic = "force-static";

export function GET() {
  return createStrudelSampleManifestResponse(dirtSamplesManifest);
}
