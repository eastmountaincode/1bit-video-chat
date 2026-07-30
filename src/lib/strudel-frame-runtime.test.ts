import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import test from "node:test";

import { STRUDEL_FRAME_DOCUMENT } from "./strudel-frame-document.ts";

interface RuntimeHarnessOptions {
  advanceDuringEvaluation?: {
    code: string;
    cycle: number;
    queriedThrough: number;
  };
  allowAudio?: boolean;
  cycle?: number;
  evaluate?: (code: string) => Promise<void>;
  fastTimeouts?: boolean;
  queriedThrough?: number;
  pendingResume?: boolean;
}

interface FakeHap {
  code: string | null;
  part: FakeTimeSpan;
  whole?: FakeTimeSpan;
}

interface FakePattern {
  query(state: FakeState): FakeHap[];
  patternAt(cycle: number): string | null;
}

interface FakeStrudelInitOptions {
  editPattern?: (pattern: FakePattern) => FakePattern;
}

class FakeTime {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }

  gte(other: number | FakeTime) {
    return this.value >= fakeTimeValue(other);
  }

  lte(other: number | FakeTime) {
    return this.value <= fakeTimeValue(other);
  }
}

class FakeTimeSpan {
  readonly begin: FakeTime;
  readonly end: FakeTime;

  constructor(begin: number | FakeTime, end: number | FakeTime) {
    this.begin = new FakeTime(fakeTimeValue(begin));
    this.end = new FakeTime(fakeTimeValue(end));
  }
}

class FakeState {
  readonly span: FakeTimeSpan;

  constructor(span: FakeTimeSpan) {
    this.span = span;
  }

  setSpan(span: FakeTimeSpan) {
    return new FakeState(span);
  }
}

class FakePatternImpl implements FakePattern {
  private readonly queryPattern: (state: FakeState) => FakeHap[];

  constructor(queryPattern: (state: FakeState) => FakeHap[]) {
    this.queryPattern = queryPattern;
  }

  query(state: FakeState) {
    return this.queryPattern(state);
  }

  patternAt(cycle: number) {
    return (
      this.query(
        new FakeState(new FakeTimeSpan(cycle, cycle + 0.0001)),
      ).find((hap) => hap.code !== null)?.code ?? null
    );
  }
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

test("running updates switch patterns at the next clean cycle", async () => {
  const harness = createRuntimeHarness({
    cycle: 0.4,
    queriedThrough: 0.55,
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

  harness.setCycle(0.6);
  harness.setQueriedThrough(0.7);
  harness.command({
    code: 'sound("hh")',
    commandId: "update-two",
    revision: "two",
    type: "update",
  });
  await harness.settle();

  assert.deepEqual(harness.evaluated, ['sound("bd")', 'sound("hh")']);
  assert.equal(harness.patternAt(0.75), 'sound("bd")');
  assert.equal(harness.patternAt(0.999), 'sound("bd")');
  assert.equal(harness.patternAt(1), 'sound("hh")');
  assert.equal(harness.patternAt(1.25), 'sound("hh")');
  assert.equal(harness.hushCount, 0);
  assert.equal(harness.startCalls, 1);
  assert.deepEqual(harness.evaluateAutoplay, [false, false]);
});

test("the visible Update button preserves phase and uses the next cycle", async () => {
  const harness = createRuntimeHarness({
    cycle: 0.2,
    queriedThrough: 0.35,
  });
  await harness.settle();
  harness.stage('sound("bd")');
  harness.runButton.click();
  await harness.settle();
  assert.equal(harness.hushCount, 1);

  harness.setCycle(0.5);
  harness.setQueriedThrough(0.65);
  harness.stage('sound("sd")');
  harness.runButton.click();
  await harness.settle();

  assert.equal(harness.hushCount, 1);
  assert.equal(harness.patternAt(0.9), 'sound("bd")');
  assert.equal(harness.patternAt(1), 'sound("sd")');
  assert.equal(harness.messages("run-request").length, 2);
  assert.equal(harness.startCalls, 1);
  assert.deepEqual(harness.evaluateAutoplay, [false, false]);
});

test("an update waits another cycle when the scheduler queried past the next one", async () => {
  const harness = createRuntimeHarness({
    cycle: 0.98,
    queriedThrough: 1.02,
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
  await harness.settle();

  assert.equal(harness.patternAt(1.5), 'sound("bd")');
  assert.equal(harness.patternAt(2), 'sound("hh")');
});

test("an update rechecks the clean boundary after asynchronous evaluation", async () => {
  const harness = createRuntimeHarness({
    advanceDuringEvaluation: {
      code: 'sound("hh")',
      cycle: 0.98,
      queriedThrough: 1.05,
    },
    cycle: 0.8,
    queriedThrough: 0.95,
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
  await harness.settle();

  assert.equal(harness.patternAt(1), 'sound("bd")');
  assert.equal(harness.patternAt(1.999), 'sound("bd")');
  assert.equal(harness.patternAt(2), 'sound("hh")');
});

test("an exact half-open query boundary can still switch on that boundary", async () => {
  const harness = createRuntimeHarness({
    cycle: 0.8,
    queriedThrough: 1,
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
  await harness.settle();

  assert.equal(harness.patternAt(0.999), 'sound("bd")');
  assert.equal(harness.patternAt(1), 'sound("hh")');
});

test("audio latency alone does not postpone an update by a cycle", async () => {
  const harness = createRuntimeHarness({
    cycle: 0.98,
    queriedThrough: 0.99,
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
  await harness.settle();

  assert.equal(harness.patternAt(0.999), 'sound("bd")');
  assert.equal(harness.patternAt(1), 'sound("hh")');
});

test("rapid updates before one boundary keep only the newest pattern", async () => {
  const harness = createRuntimeHarness({
    cycle: 0.2,
    queriedThrough: 0.3,
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

  harness.setCycle(0.4);
  harness.setQueriedThrough(0.5);
  harness.command({
    code: 'sound("hh")',
    commandId: "update-two",
    revision: "two",
    type: "update",
  });
  await harness.settle();
  harness.setCycle(0.6);
  harness.setQueriedThrough(0.7);
  harness.command({
    code: 'sound("sd")',
    commandId: "update-three",
    revision: "three",
    type: "update",
  });
  await harness.settle();

  assert.equal(harness.patternAt(0.999), 'sound("bd")');
  assert.equal(harness.patternAt(1), 'sound("sd")');
});

test("an already-scheduled transition survives until a later update boundary", async () => {
  const harness = createRuntimeHarness({
    cycle: 0.2,
    queriedThrough: 0.3,
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

  harness.setCycle(0.5);
  harness.setQueriedThrough(0.6);
  harness.command({
    code: 'sound("hh")',
    commandId: "update-two",
    revision: "two",
    type: "update",
  });
  await harness.settle();
  harness.setCycle(0.9);
  harness.setQueriedThrough(1.1);
  harness.command({
    code: 'sound("sd")',
    commandId: "update-three",
    revision: "three",
    type: "update",
  });
  await harness.settle();

  assert.equal(harness.patternAt(0.999), 'sound("bd")');
  assert.equal(harness.patternAt(1), 'sound("hh")');
  assert.equal(harness.patternAt(1.999), 'sound("hh")');
  assert.equal(harness.patternAt(2), 'sound("sd")');
});

test("cycle transitions preserve continuous haps across a split query", async () => {
  const harness = createRuntimeHarness({
    cycle: 0.6,
    queriedThrough: 0.7,
  });
  await harness.settle();
  harness.stage("signal(old)");
  harness.command({
    code: "signal(old)",
    commandId: "run-one",
    revision: "one",
    type: "update",
  });
  await harness.settle();

  harness.command({
    code: "signal(next)",
    commandId: "update-two",
    revision: "two",
    type: "update",
  });
  await harness.settle();

  assert.deepEqual(harness.patternSegments(0.9, 1.1), [
    {
      begin: 0.9,
      code: "signal(old)",
      end: 1,
      hasWhole: false,
    },
    {
      begin: 1,
      code: "signal(next)",
      end: 1.1,
      hasWhole: false,
    },
  ]);
});

test("tempo keeps native Strudel timing while its pattern waits for the boundary", async () => {
  const harness = createRuntimeHarness({
    cycle: 0.4,
    queriedThrough: 0.6,
  });
  await harness.settle();
  harness.stage('setcpm(120); sound("bd")');
  harness.command({
    code: 'setcpm(120); sound("bd")',
    commandId: "run-one",
    revision: "one",
    type: "update",
  });
  await harness.settle();
  assert.equal(harness.schedulerCps, 2);

  harness.setCycle(0.7);
  harness.setQueriedThrough(0.8);
  harness.command({
    code: 'setcpm(60); sound("hh")',
    commandId: "update-two",
    revision: "two",
    type: "update",
  });
  await harness.settle();

  assert.equal(harness.schedulerCps, 1);
  assert.equal(
    harness.patternAt(0.999),
    'setcpm(120); sound("bd")',
  );
  assert.equal(
    harness.patternAt(1),
    'setcpm(60); sound("hh")',
  );
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

test("a stopped hung evaluation asks the parent to rebuild its frame", async () => {
  const neverSettles = new Promise<void>(() => {});
  const harness = createRuntimeHarness({
    evaluate: async () => {
      await neverSettles;
    },
    fastTimeouts: true,
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

  assert.deepEqual(harness.evaluated, ['sound("bd")']);
  assert.equal(harness.maxConcurrentEvaluations, 1);
  assert.equal(harness.messages("reset-request").length, 1);
  assert.equal(harness.startCalls, 0);
  assert.equal(
    harness.messages("result").some(
      (message) => message.ok === true && message.revision === "three",
    ),
    false,
  );
});

test("stop then run serializes and evaluates the replacement once", async () => {
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
    ['sound("bd")', 'sound("hh")'],
  );
  assert.equal(harness.runButton.textContent, "update");
  assert.equal(harness.hushCount, 1);
  assert.equal(harness.patternAt(1), 'sound("hh")');
  assert.equal(harness.maxConcurrentEvaluations, 1);
  assert.equal(harness.startCalls, 1);
  assert.equal(
    harness.messages("result").filter(
      (message) =>
        message.ok === true && message.revision === "three",
    ).length,
    1,
  );
});

test("a stopped stale evaluation never autostarts", async () => {
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

  assert.deepEqual(harness.evaluateAutoplay, [false]);
  assert.equal(harness.startCalls, 0);
  assert.equal(harness.runButton.textContent, "run");
  assert.equal(harness.stopButton.hidden, true);
  assert.equal(
    harness.messages("result").some((message) => message.ok === true),
    false,
  );
});

test("blocked autoplay keeps shared intent staged for a local retry", async () => {
  const harness = createRuntimeHarness({ allowAudio: false });
  await harness.settle();
  harness.stage('sound("metal")');
  harness.command({
    code: 'sound("metal")',
    commandId: "remote-run",
    revision: `${'sound("metal")'.length}:test`,
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
  assert.equal(harness.messages("run-request").length, 0);
});

test("editing after a failed run publishes and evaluates the correction", async () => {
  const harness = createRuntimeHarness({ allowAudio: false });
  await harness.settle();
  harness.stage('sound("missing")');
  harness.command({
    code: 'sound("missing")',
    commandId: "remote-run",
    revision: `${'sound("missing")'.length}:test`,
    type: "update",
  });
  await harness.settle();

  harness.stage('sound("bd")');
  harness.setAudioAllowed(true);
  harness.runButton.click();
  await harness.settle();

  assert.deepEqual(harness.evaluated, ['sound("bd")']);
  const request = harness.messages("run-request")[0];
  assert.equal(request?.code, 'sound("bd")');
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
    revision: `${'sound("metal")'.length}:test`,
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
  const evaluateAutoplay: boolean[] = [];
  const posted: Array<Record<string, unknown>> = [];
  const messageListeners: Array<(event: unknown) => void> = [];
  let activeEvaluations = 0;
  let allowAudio = options.allowAudio ?? true;
  let hushCount = 0;
  let maxConcurrentEvaluations = 0;
  let resumeCalls = 0;
  let startCalls = 0;
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
  let currentCycle = options.cycle ?? 0.25;
  let queriedThrough = options.queriedThrough ?? currentCycle;
  let editPattern: ((pattern: FakePattern) => FakePattern) | undefined;
  const scheduler = {
    cps: 0.5,
    latency: 0.1,
    started: false,
    get lastEnd() {
      return queriedThrough;
    },
    now() {
      return currentCycle;
    },
    pattern: null as FakePattern | null,
    setCps(cps: number) {
      this.cps = Number(cps);
    },
  };
  const runtime = {
    scheduler,
    async start() {
      startCalls += 1;
      scheduler.started = true;
    },
  };
  const api = {
    Pattern: FakePatternImpl,
    TimeSpan: FakeTimeSpan,
    async evaluate(code: string, autoplay = true) {
      evaluated.push(code);
      evaluateAutoplay.push(autoplay);
      activeEvaluations += 1;
      maxConcurrentEvaluations = Math.max(
        maxConcurrentEvaluations,
        activeEvaluations,
      );
      try {
        await options.evaluate?.(code);
        if (options.advanceDuringEvaluation?.code === code) {
          currentCycle = options.advanceDuringEvaluation.cycle;
          queriedThrough =
            options.advanceDuringEvaluation.queriedThrough;
        }
        const cpmMatch = code.match(
          /setcpm\(\s*([0-9]+(?:\.[0-9]+)?)\s*\)/i,
        );
        if (cpmMatch) {
          scheduler.setCps(Number(cpmMatch[1]) / 60);
        }
        const pattern = createFakePattern(code);
        scheduler.pattern = editPattern?.(pattern) ?? pattern;
        if (autoplay && !scheduler.started) {
          await runtime.start();
        }
        return scheduler.pattern;
      } finally {
        activeEvaluations -= 1;
      }
    },
    getAudioContext() {
      return audioContext;
    },
    hush() {
      hushCount += 1;
      scheduler.started = false;
    },
    async initAudio() {},
    async initStrudel(options: FakeStrudelInitOptions) {
      editPattern = options.editPattern;
      return runtime;
    },
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
    evaluateAutoplay,
    get hushCount() {
      return hushCount;
    },
    get maxConcurrentEvaluations() {
      return maxConcurrentEvaluations;
    },
    messages(type: string) {
      return posted.filter((message) => message.type === type);
    },
    patternAt(cycle: number) {
      return scheduler.pattern?.patternAt(cycle) ?? null;
    },
    patternSegments(begin: number, end: number) {
      const haps = Array.from(
        scheduler.pattern?.query(
          new FakeState(new FakeTimeSpan(begin, end)),
        ) ?? [],
      );
      return haps
        .filter((hap) => hap.code !== null)
        .map((hap) => ({
          begin: hap.part.begin.value,
          code: hap.code,
          end: hap.part.end.value,
          hasWhole: hap.whole !== undefined,
        }));
    },
    get resumeCalls() {
      return resumeCalls;
    },
    get schedulerCps() {
      return scheduler.cps;
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
    setCycle(cycle: number) {
      currentCycle = cycle;
    },
    setQueriedThrough(cycle: number) {
      queriedThrough = cycle;
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
    get startCalls() {
      return startCalls;
    },
    stopButton,
  };
}

function createFakePattern(code: string): FakePattern {
  const continuous = code.startsWith("signal(");
  return new FakePatternImpl((state) => {
    const begin = state.span.begin.value;
    return [
      {
        code,
        part: state.span,
        ...(continuous
          ? {}
          : {
              whole: new FakeTimeSpan(
                Math.floor(begin),
                Math.floor(begin) + 1,
              ),
            }),
      },
    ];
  });
}

function fakeTimeValue(value: number | FakeTime) {
  return value instanceof FakeTime ? value.value : value;
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
