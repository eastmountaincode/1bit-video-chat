import drumMachinesManifest from "@/lib/strudel-samples/tidal-drum-machines.json";
import { createStrudelSampleManifestResponse } from "@/lib/strudel-sample-manifest-response";

export const dynamic = "force-static";

export function GET() {
  return createStrudelSampleManifestResponse(drumMachinesManifest);
}
