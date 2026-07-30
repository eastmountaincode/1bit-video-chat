import { STRUDEL_SAMPLE_CATALOGS } from "./strudel-sample-catalogs.ts";

export const STRUDEL_FRAME_DOCUMENT = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      * {
        box-sizing: border-box;
      }

      html {
        color-scheme: light;
      }

      body {
        align-items: center;
        background: transparent;
        display: flex;
        font-family: "Times New Roman", Times, serif;
        font-size: 17px;
        gap: 0.5rem;
        height: 100%;
        justify-content: flex-end;
        line-height: 1.3;
        margin: 0;
        overflow: hidden;
      }

      button {
        background: #efefef;
        border: 1px solid #000;
        border-radius: 0;
        color: #111;
        cursor: pointer;
        font: inherit;
        min-height: 1.75rem;
        padding: 0.125rem 0.5rem;
      }

      button:active {
        background: #ddd;
      }

      button:disabled {
        color: #777;
        cursor: not-allowed;
      }
    </style>
  </head>
  <body>
    <button disabled hidden id="stop" type="button">stop</button>
    <button disabled id="run" type="button">run</button>
    <script src="/strudel-web-1.3.0/index.js"></script>
    <script>
      (() => {
        const SOURCE = "telepathy-strudel";
        const AUDIO_RESUME_TIMEOUT_MS = 750;
        const EVALUATION_RESET_TIMEOUT_MS = 2000;
        const MAX_CODE_LENGTH = 10000;
        const SAMPLE_CATALOGS = ${JSON.stringify(STRUDEL_SAMPLE_CATALOGS)};
        const runButton = document.querySelector("#run");
        const stopButton = document.querySelector("#stop");
        let canRun = false;
        let controlsDisabled = true;
        let desiredEnabled = false;
        let evaluating = false;
        let evaluationGeneration = 0;
        let activeEvaluationGeneration = 0;
        let evaluationError = null;
        let evaluationResetTimer = null;
        let initialized = false;
        let lastAppliedCommandKey = "";
        let latestDesiredEvaluation = null;
        let pendingEvaluation = null;
        let running = false;
        let sampleCatalogsPromise = null;
        let stagedCode = "";
        let stagedRevision = "";
        let activePattern = null;
        let requestedTransitionBoundary = null;
        let strudelRuntime = null;
        let transitionBoundary = null;

        function send(message) {
          window.parent.postMessage({ source: SOURCE, ...message }, "*");
        }

        function errorMessage(error) {
          return error && typeof error.message === "string"
            ? error.message.slice(0, 500)
            : String(error).slice(0, 500);
        }

        function updateButtons() {
          runButton.textContent = desiredEnabled ? "update" : "run";
          runButton.disabled =
            !initialized ||
            controlsDisabled ||
            evaluating ||
            !canRun ||
            !stagedCode.trim();
          stopButton.disabled =
            !initialized || controlsDisabled || !desiredEnabled;
          stopButton.hidden = !desiredEnabled;
        }

        const api = globalThis.strudel;
        if (
          !api ||
          typeof api.initStrudel !== "function" ||
          typeof api.initAudio !== "function" ||
          typeof api.getAudioContext !== "function" ||
          typeof api.evaluate !== "function" ||
          typeof api.hush !== "function" ||
          typeof api.samples !== "function" ||
          typeof api.Pattern !== "function" ||
          typeof api.TimeSpan !== "function"
        ) {
          send({
            error: "Strudel could not load.",
            ok: false,
            revision: "",
            type: "result",
          });
          return;
        }

        function loadSampleCatalogs() {
          if (!sampleCatalogsPromise) {
            sampleCatalogsPromise = Promise.all(
              SAMPLE_CATALOGS.map(({ baseUrl, manifestUrl }) =>
                api.samples(manifestUrl, baseUrl),
              ),
            ).catch((error) => {
              sampleCatalogsPromise = null;
              throw error;
            });
          }
          return sampleCatalogsPromise;
        }

        function transitionAt(previousPattern, nextPattern, boundary) {
          return new api.Pattern((state) => {
            const { span } = state;
            if (span.begin.gte(boundary)) {
              return nextPattern.query(state);
            }
            if (span.end.lte(boundary)) {
              return previousPattern.query(state);
            }
            return [
              ...previousPattern.query(
                state.setSpan(
                  new api.TimeSpan(span.begin, boundary),
                ),
              ),
              ...nextPattern.query(
                state.setSpan(
                  new api.TimeSpan(boundary, span.end),
                ),
              ),
            ];
          });
        }

        function nextTransitionBoundary(scheduler) {
          const currentCycle =
            typeof scheduler?.now === "function"
              ? Number(scheduler.now())
              : Number.NaN;
          if (!Number.isFinite(currentCycle)) return null;
          const nextAfterCurrentCycle =
            Math.floor(currentCycle) + 1;
          const queriedThrough = Number(scheduler.lastEnd);
          return Math.max(
            nextAfterCurrentCycle,
            Number.isFinite(queriedThrough)
              ? Math.ceil(queriedThrough)
              : nextAfterCurrentCycle,
          );
        }

        function editPattern(nextPattern) {
          const scheduler = strudelRuntime?.scheduler;
          const currentPattern = scheduler?.pattern;
          const currentCycle =
            typeof scheduler?.now === "function"
              ? Number(scheduler.now())
              : Number.NaN;
          if (
            activeEvaluationGeneration !== evaluationGeneration
          ) {
            requestedTransitionBoundary = null;
            return nextPattern;
          }
          if (
            !running ||
            !activePattern ||
            !scheduler ||
            !currentPattern ||
            !Number.isFinite(currentCycle)
          ) {
            activePattern = nextPattern;
            requestedTransitionBoundary = null;
            transitionBoundary = null;
            return nextPattern;
          }

          const currentSafeBoundary =
            nextTransitionBoundary(scheduler);
          const boundary =
            requestedTransitionBoundary === null
              ? currentSafeBoundary
              : currentSafeBoundary === null
                ? requestedTransitionBoundary
                : Math.max(
                    requestedTransitionBoundary,
                    currentSafeBoundary,
                  );
          requestedTransitionBoundary = null;
          if (!Number.isFinite(boundary)) {
            activePattern = nextPattern;
            transitionBoundary = null;
            return nextPattern;
          }
          const previousPattern =
            transitionBoundary !== null &&
            currentCycle >= transitionBoundary
              ? activePattern
              : currentPattern;
          const transitionPattern = transitionAt(
            previousPattern,
            nextPattern,
            boundary,
          );

          activePattern = nextPattern;
          transitionBoundary = boundary;
          return transitionPattern;
        }

        const initialization = Promise.resolve()
          .then(() =>
            api.initStrudel({
              editPattern,
              onEvalError(error) {
                evaluationError = errorMessage(error);
              },
            }),
          )
          .then((runtime) => {
            if (
              !runtime ||
              !runtime.scheduler ||
              typeof runtime.scheduler.now !== "function" ||
              typeof runtime.start !== "function"
            ) {
              throw new Error("Strudel scheduler could not load.");
            }
            strudelRuntime = runtime;
            return runtime;
          });

        initialization.then(
          () => {
            initialized = true;
            updateButtons();
            send({ type: "ready" });
          },
          (error) => {
            send({
              error: errorMessage(error),
              ok: false,
              revision: "",
              type: "result",
            });
          },
        );

        function prepareAudio() {
          const audioContext = api.getAudioContext();
          const resumePromise =
            audioContext.state === "running"
              ? Promise.resolve()
              : audioContext.resume();
          void resumePromise.catch(() => {});
          return { audioContext, resumePromise };
        }

        function waitForAudioResume(resumePromise) {
          return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              reject(
                new Error("Audio playback requires a local interaction."),
              );
            }, AUDIO_RESUME_TIMEOUT_MS);
            resumePromise.then(
              () => {
                clearTimeout(timeoutId);
                resolve();
              },
              (error) => {
                clearTimeout(timeoutId);
                reject(error);
              },
            );
          });
        }

        async function ensureAudio(preparedAudio) {
          await waitForAudioResume(preparedAudio.resumePromise);
          await api.initAudio();
          if (
            preparedAudio.audioContext.state !== "running" &&
            preparedAudio.audioContext.state !== "closed"
          ) {
            await waitForAudioResume(
              preparedAudio.audioContext.resume(),
            );
          }
          if (preparedAudio.audioContext.state !== "running") {
            throw new Error("Audio playback requires a local interaction.");
          }
        }

        function drainEvaluationQueue() {
          if (evaluating || !pendingEvaluation) return;
          const request = pendingEvaluation;
          pendingEvaluation = null;
          void evaluatePattern(request);
        }

        function queueEvaluation(request) {
          pendingEvaluation = request;
          drainEvaluationQueue();
        }

        function clearEvaluationResetTimer() {
          if (evaluationResetTimer === null) return;
          clearTimeout(evaluationResetTimer);
          evaluationResetTimer = null;
        }

        function scheduleEvaluationReset() {
          clearEvaluationResetTimer();
          if (!evaluating) return;
          evaluationResetTimer = setTimeout(() => {
            evaluationResetTimer = null;
            if (
              evaluating &&
              activeEvaluationGeneration !== evaluationGeneration
            ) {
              send({ type: "reset-request" });
            }
          }, EVALUATION_RESET_TIMEOUT_MS);
        }

        async function evaluatePattern(request) {
          const {
            code,
            preparedAudio,
            restart,
            revision,
          } = request;
          if (controlsDisabled || !code.trim()) return;
          const generation = ++evaluationGeneration;
          activeEvaluationGeneration = generation;
          const wasRunning = running;
          let restarted = false;
          evaluating = true;
          evaluationError = null;
          requestedTransitionBoundary = null;
          updateButtons();

          try {
            await initialization;
            await ensureAudio(preparedAudio);
            await loadSampleCatalogs();
            if (generation !== evaluationGeneration) return;
            if (restart) {
              api.hush();
              restarted = true;
              running = false;
              activePattern = null;
              transitionBoundary = null;
            }
            if (wasRunning && !restart) {
              requestedTransitionBoundary =
                nextTransitionBoundary(
                  strudelRuntime.scheduler,
                );
            }
            const evaluatedPattern = await api.evaluate(code, false);
            if (generation !== evaluationGeneration) {
              activePattern = null;
              requestedTransitionBoundary = null;
              transitionBoundary = null;
              return;
            }
            if (evaluationError || !evaluatedPattern) {
              throw new Error(
                evaluationError || "Strudel pattern could not run.",
              );
            }
            if (!running) {
              await strudelRuntime.start();
              if (generation !== evaluationGeneration) {
                api.hush();
                activePattern = null;
                transitionBoundary = null;
                return;
              }
            }
            running = true;
            send({ ok: true, revision, type: "result" });
          } catch (error) {
            if (generation !== evaluationGeneration) return;
            running = restarted ? false : wasRunning;
            send({
              error: errorMessage(error),
              ok: false,
              revision,
              type: "result",
            });
          } finally {
            requestedTransitionBoundary = null;
            if (activeEvaluationGeneration !== generation) return;
            clearEvaluationResetTimer();
            activeEvaluationGeneration = 0;
            evaluating = false;
            updateButtons();
            drainEvaluationQueue();
          }
        }

        function stopPattern() {
          latestDesiredEvaluation = null;
          pendingEvaluation = null;
          evaluationGeneration += 1;
          api.hush();
          running = false;
          activePattern = null;
          requestedTransitionBoundary = null;
          transitionBoundary = null;
          scheduleEvaluationReset();
          updateButtons();
          send({ type: "stopped" });
        }

        window.addEventListener("message", (event) => {
          const command = event.data;
          if (
            event.source !== window.parent ||
            !command ||
            command.source !== SOURCE
          ) {
            return;
          }

          if (
            command.type === "stop" &&
            typeof command.commandId === "string" &&
            command.commandId.length > 0 &&
            command.commandId.length <= 128
          ) {
            const commandKey = "stop:" + command.commandId;
            desiredEnabled = false;
            if (commandKey === lastAppliedCommandKey) {
              updateButtons();
              return;
            }
            lastAppliedCommandKey = commandKey;
            stopPattern();
            return;
          }
          if (command.type === "stage") {
            if (
              typeof command.code !== "string" ||
              command.code.length > MAX_CODE_LENGTH ||
              typeof command.revision !== "string" ||
              typeof command.canRun !== "boolean" ||
              typeof command.disabled !== "boolean"
            ) {
              return;
            }
            stagedCode = command.code;
            stagedRevision = command.revision;
            canRun = command.canRun;
            controlsDisabled = command.disabled;
            updateButtons();
            return;
          }
          if (
            command.type !== "update" ||
            typeof command.code !== "string" ||
            command.code.length > MAX_CODE_LENGTH ||
            typeof command.revision !== "string" ||
            typeof command.commandId !== "string" ||
            command.commandId.length === 0 ||
            command.commandId.length > 128
          ) {
            return;
          }

          const commandKey = "update:" + command.commandId;
          desiredEnabled = true;
          if (commandKey === lastAppliedCommandKey) {
            updateButtons();
            return;
          }
          lastAppliedCommandKey = commandKey;
          updateButtons();
          latestDesiredEvaluation = {
            code: command.code,
            preparedAudio: prepareAudio(),
            restart: false,
            revision: command.revision,
          };
          queueEvaluation(latestDesiredEvaluation);
        });

        runButton.addEventListener("click", () => {
          if (runButton.disabled) return;
          const isLocalRetry =
            desiredEnabled &&
            !running &&
            latestDesiredEvaluation &&
            stagedCode === latestDesiredEvaluation.code &&
            stagedRevision === latestDesiredEvaluation.revision;
          const commandId = crypto.randomUUID();
          const restart = !running;
          desiredEnabled = true;
          updateButtons();
          latestDesiredEvaluation = {
            code: isLocalRetry
              ? latestDesiredEvaluation.code
              : stagedCode,
            preparedAudio: prepareAudio(),
            restart,
            revision: isLocalRetry
              ? latestDesiredEvaluation.revision
              : stagedRevision,
          };
          queueEvaluation(latestDesiredEvaluation);
          if (!isLocalRetry) {
            lastAppliedCommandKey = "update:" + commandId;
            send({
              code: stagedCode,
              commandId,
              revision: stagedRevision,
              type: "run-request",
            });
          }
        });

        stopButton.addEventListener("click", () => {
          if (stopButton.disabled) return;
          const commandId = crypto.randomUUID();
          desiredEnabled = false;
          lastAppliedCommandKey = "stop:" + commandId;
          stopPattern();
          send({ commandId, type: "stop-request" });
        });

        updateButtons();
      })();
    </script>
  </body>
</html>`;
