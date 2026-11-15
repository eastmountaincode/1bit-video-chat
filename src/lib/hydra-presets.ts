import { randomInt } from "node:crypto";

import { HYDRA_EXAMPLES } from "./hydra-examples.ts";
import { formatHydraExample } from "./hydra-randomizer.ts";
import { DEFAULT_ROOM_HYDRA, type RoomHydraData } from "./room-hydra.ts";

export function chooseHydraSketchId(): string {
    return HYDRA_EXAMPLES[randomInt(HYDRA_EXAMPLES.length)].id;
}

export function getInitialRoomHydra(sketchId?: string): RoomHydraData {
    const sketch = HYDRA_EXAMPLES.find((example) => example.id === sketchId);
    if (!sketch) return { ...DEFAULT_ROOM_HYDRA };

    return {
        ...DEFAULT_ROOM_HYDRA,
        code: formatHydraExample(sketch),
    };
}
