import { HYDRA_EXAMPLES } from "./hydra-examples.ts";

export function formatHydraExample(sketch: { id: string; code: string }): string {
    return `// licensed with CC BY-NC-SA 4.0 https://creativecommons.org/licenses/by-nc-sa/4.0/\n// https://hydra.ojack.xyz/?sketch_id=${sketch.id}\n${sketch.code}`;
}

export function chooseRandomHydraCode(currentCode: string, random = Math.random): string {
    const choices = HYDRA_EXAMPLES.filter((sketch) =>
        sketch.code.trim() !== currentCode.trim() && formatHydraExample(sketch).trim() !== currentCode.trim(),
    );
    const sketch = choices[Math.floor(random() * choices.length)];
    return formatHydraExample(sketch);
}
