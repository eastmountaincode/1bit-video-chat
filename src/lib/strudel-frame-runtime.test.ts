import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import test from "node:test";

import { STRUDEL_FRAME_DOCUMENT } from "./strudel-frame-document.ts";

interface RuntimeHarnessOptions {
  allowAudio?: boolean;
  evaluate?: (code: string) => Promise<void>;
  fastTimeouts?: boolean;
  pendingResume?: boolean;
}

test("shared Strudel commands start, update, deduplicate, and stop locally", async () => {
  const harness = createRuntimeHarness();
  await harness.settle();
  harness.stage('sound("bd")');

  harness.command({
    code: 'sound("bd")',
    commandId: "run-one",
    revision: "one",
    type: "update",
  });
  await harness.settle();
  assert.deepEqual(harness.evaluated, ['sound("bd")']);
  assert.equal(harness.hushCount, 0);

  harness.command({
    code: 'sound("bd")',
    commandId: "run-one",
    revision: "one",
    type: "update",
  });
  await harness.settle();
  assert.deepEqual(harness.evaluated, ['sound("bd")']);

  harness.command({
    commandId: "run-one",
    type: "stop",
  });
  await harness.settle();
  assert.equal(harness.hushCount, 1);
  assert.equal(harness.runButton.textContent, "run");

  harness.command({
    code: 'sound("hh")',
    commandId: "update-two",
    revision: "two",
    type: "update",
  });
  await harness.settle();
  assert.deepEqual(harness.evaluated, ['sound("bd")', 'sound("hh")']);
  assert.equal(harness.hushCount, 1);

  harness.command({
    commandId: "stop-three",
    type: "stop",
  });
  await harness.settle();
  assert.equal(harness.hushCount, 2);
  assert.equal(harness.runButton.textContent, "run");
  assert.equal(harness.stopButton.hidden, true);
});

test("the iframe Run click unlocks locally and publishes one shared request", async () => {
  const harness = createRuntimeHarness({ allowAudio: false });
  await harness.settle();
  harness.stage('sound("bd")');
  harness.setAudioAllowed(true);

  harness.runButton.click();
  assert.equal(harness.resumeCalls, 1);
  const request = harness.messages("run-request")[0];
  assert.equal(request?.commandId, "local-1");
  assert.equal(request?.code, 'sound("bd")');
  await harness.settle();
  assert.deepEqual(harness.evaluated, ['sound("bd")']);

  harness.command({
    code: 'sound("bd")',
    commandId: "local-1",
    revision: request?.revision,
    type: "update",
  });
  await harness.settle();
  assert.deepEqual(harness.evaluated, ['sound("bd")']);
});

test("busy Strudel evaluation keeps only the newest shared update", async () => {
  let releaseFirst: (() => void) | null = null;
  const firstEvaluation = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const harness = createRuntimeHarness({
    evaluate: async (code) => {
      if (code === 'sound("bd")') await firstEvaluation;
    },
  });
  await harness.settle();
  harness.stage('sound("bd")');
  harness.command({
    code: 'sound("bd")',
    commandId: "run-one",
    revision: "one",
    type: "update",
  });
  await harness.settle();

  harness.command({
    code: 'sound("hh")',
    commandId: "update-two",
    revision: "two",
    type: "update",
  });
  harness.command({
    code: 'sound("sd")',
    commandId: "update-three",
    revision: "three",
    type: "update",
  });
  releaseFirst?.();
  await harness.settle();

  assert.deepEqual(harness.evaluated, ['sound("bd")', 'sound("sd")']);
});

test("a shared stop cancels an in-flight evaluation", async () => {
  let releaseEvaluation: (() => void) | null = null;
  const evaluation = new Promise<void>((resolve) => {
    releaseEvaluation = resolve;
  });
  const harness = createRuntimeHarness({
    evaluate: async () => {
      await evaluation;
    },
  });
  await harness.settle();
  harness.stage('sound("bd")');
  harness.command({
    code: 'sound("bd")',
    commandId: "run-one",
    revision: "one",
    type: "update",
  });
  await harness.settle();

  harness.command({
    commandId: "stop-two",
    type: "stop",
  });
  releaseEvaluation?.();
  await harness.settle();

  assert.equal(harness.runButton.textContent, "run");
  assert.equal(harness.stopButton.hidden, true);
  assert.equal(
    harness.messages("result").some((message) => message.ok === true),
    false,
  );
  assert.ok(harness.hushCount >= 1);
});

test("a shared stop releases a never-settling evaluation", async () => {
  const neverSettles = new Promise<void>(() => {});
  const harness = createRuntimeHarness({
    evaluate: async (code) => {
      if (code === 'sound("bd")') await neverSettles;
    },
  });
  await harness.settle();
  harness.stage('sound("bd")');
  harness.command({
    code: 'sound("bd")',
    commandId: "run-one",
    revision: "one",
    type: "update",
  });
  await harness.settle();

  harness.command({
    commandId: "stop-two",
    type: "stop",
  });
  harness.command({
    code: 'sound("hh")',
    commandId: "run-three",
    revision: "three",
    type: "update",
  });
  await harness.settle();

  assert.deepEqual(harness.evaluated, ['sound("bd")', 'sound("hh")']);
  assert.equal(harness.runButton.textContent, "update");
  assert.equal(
    harness.messages("result").some(
      (message) => message.ok === true && message.revision === "three",
    ),
    true,
  );
});

test("a stale evaluation cannot replace a newer shared run", async () => {
  let releaseStale: (() => void) | null = null;
  const staleEvaluation = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  const harness = createRuntimeHarness({
    evaluate: async (code) => {
      if (code === 'sound("bd")') await staleEvaluation;
    },
  });
  await harness.settle();
  harness.stage('sound("bd")');
  harness.command({
    code: 'sound("bd")',
    commandId: "run-one",
    revision: "one",
    type: "update",
  });
  await harness.settle();

  harness.command({
    commandId: "stop-two",
    type: "stop",
  });
  harness.command({
    code: 'sound("hh")',
    commandId: "run-three",
    revision: "three",
    type: "update",
  });
  await harness.settle();
  releaseStale?.();
  await harness.settle();

  assert.deepEqual(
    harness.evaluated,
    ['sound("bd")', 'sound("hh")', 'sound("hh")'],
  );
  assert.equal(harness.runButton.textContent, "update");
  assert.ok(harness.hushCount >= 2);
});

test("blocked autoplay keeps shared intent staged for a local retry", async () => {
  const harness = createRuntimeHarness({ allowAudio: false });
  await harness.settle();
  harness.stage('sound("metal")');
  harness.command({
    code: 'sound("metal")',
    commandId: "remote-run",
    revision: "remote",
    type: "update",
  });
  await harness.settle();

  assert.deepEqual(harness.evaluated, []);
  assert.equal(harness.runButton.textContent, "update");
  assert.equal(harness.stopButton.hidden, false);
  assert.equal(harness.messages("stop-request").length, 0);

  harness.setAudioAllowed(true);
  harness.runButton.click();
  await harness.settle();
  assert.deepEqual(harness.evaluated, ['sound("metal")']);
  assert.equal(harness.messages("run-request").length, 1);
});

test("a pending browser resume leaves the local unlock button usable", async () => {
  const harness = createRuntimeHarness({
    allowAudio: false,
    fastTimeouts: true,
    pendingResume: true,
  });
  await harness.settle();
  harness.stage('sound("metal")');
  harness.command({
    code: 'sound("metal")',
    commandId: "remote-run",
    revision: "remote",
    type: "update",
  });
  await harness.settle();

  assert.equal(harness.runButton.textContent, "update");
  assert.equal(harness.runButton.disabled, false);
  assert.deepEqual(harness.evaluated, []);

  harness.setAudioAllowed(true);
  harness.runButton.click();
  await harness.settle();
  assert.deepEqual(harness.evaluated, ['sound("metal")']);
});

function createRuntimeHarness(
  options: RuntimeHarnessOptions = {},
) {
  const runButton = new FakeButton();
  const stopButton = new FakeButton();
  const evaluated: string[] = [];
  const posted: Array<Record<string, unknown>> = [];
  const messageListeners: Array<(event: unknown) => void> = [];
  let allowAudio = options.allowAudio ?? true;
  let hushCount = 0;
  let resumeCalls = 0;
  let commandSequence = 0;
  const audioContext = {
    state: allowAudio ? "running" : "suspended",
    async resume() {
      resumeCalls += 1;
      if (!allowAudio) {
        if (options.pendingResume) {
          await new Promise<void>(() => {});
        }
        const error = new Error("Audio is blocked");
        error.name = "NotAllowedError";
        throw error;
      }
      this.state = "running";
    },
  };
  const parentWindow = {
    postMessage(message: Record<string, unknown>) {
      posted.push(message);
    },
  };
  const windowObject = {
    addEventListener(
      type: string,
      listener: (event: unknown) => void,
    ) {
      if (type === "message") messageListeners.push(listener);
    },
    parent: parentWindow,
  };
  const documentObject = {
    addEventListener() {},
    querySelector(selector: string) {
      return selector === "#run" ? runButton : stopButton;
    },
  };
  const api = {
    async evaluate(code: string) {
      evaluated.push(code);
      await options.evaluate?.(code);
    },
    getAudioContext() {
      return audioContext;
    },
    hush() {
      hushCount += 1;
    },
    async initAudio() {},
    async initStrudel() {},
    async samples() {},
  };
  const scriptMatches = [
    ...STRUDEL_FRAME_DOCUMENT.matchAll(
      /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g,
    ),
  ];
  const runtimeScript = scriptMatches.at(-1)?.[1];
  assert.ok(runtimeScript);

  runInNewContext(runtimeScript, {
    crypto: {
      randomUUID() {
        commandSequence += 1;
        return `local-${commandSequence}`;
      },
    },
    document: documentObject,
    strudel: api,
    clearTimeout,
    setTimeout: options.fastTimeouts
      ? (callback: () => void) => setImmediate(callback)
      : setTimeout,
    window: windowObject,
  });

  return {
    command(command: Record<string, unknown>) {
      for (const listener of messageListeners) {
        listener({
          data: {
            source: "telepathy-strudel",
            ...command,
          },
          source: parentWindow,
        });
      }
    },
    evaluated,
    get hushCount() {
      return hushCount;
    },
    messages(type: string) {
      return posted.filter((message) => message.type === type);
    },
    get resumeCalls() {
      return resumeCalls;
    },
    runButton,
    async settle() {
      for (let index = 0; index < 6; index += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    },
    setAudioAllowed(allowed: boolean) {
      allowAudio = allowed;
      if (!allowed) audioContext.state = "suspended";
    },
    stage(code: string) {
      this.command({
        canRun: true,
        code,
        disabled: false,
        revision: `${code.length}:test`,
        type: "stage",
      });
    },
    stopButton,
  };
}

class FakeButton {
  disabled = false;
  hidden = false;
  textContent = "";
  readonly #listeners: Array<() => void> = [];

  addEventListener(type: string, listener: () => void) {
    if (type === "click") this.#listeners.push(listener);
  }

  click() {
    for (const listener of this.#listeners) listener();
  }
}
