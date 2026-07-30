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
        let initialized = false;
        let lastAppliedCommandKey = "";
        let latestDesiredEvaluation = null;
        let pendingEvaluation = null;
        let running = false;
        let sampleCatalogsPromise = null;
        let stagedCode = "";
        let stagedRevision = "";

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
          typeof api.samples !== "function"
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

        const initialization = Promise.resolve().then(() =>
          api.initStrudel({
            onEvalError(error) {
              evaluationError = errorMessage(error);
            },
          }),
        );

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

        function queueEvaluation(request) {
          if (evaluating) {
            pendingEvaluation = request;
            return;
          }
          void evaluatePattern(request);
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
          updateButtons();

          try {
            await initialization;
            await ensureAudio(preparedAudio);
            await loadSampleCatalogs();
            if (generation !== evaluationGeneration) return;
            if (restart) {
              api.hush();
              restarted = true;
            }
            await api.evaluate(code);
            if (generation !== evaluationGeneration) {
              api.hush();
              if (desiredEnabled && latestDesiredEvaluation) {
                queueEvaluation({
                  ...latestDesiredEvaluation,
                  preparedAudio: prepareAudio(),
                  restart: false,
                });
              }
              return;
            }
            if (evaluationError) {
              throw new Error(evaluationError);
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
            if (activeEvaluationGeneration !== generation) return;
            activeEvaluationGeneration = 0;
            evaluating = false;
            updateButtons();
            const nextEvaluation = pendingEvaluation;
            pendingEvaluation = null;
            if (nextEvaluation) queueEvaluation(nextEvaluation);
          }
        }

        function stopPattern() {
          latestDesiredEvaluation = null;
          pendingEvaluation = null;
          evaluationGeneration += 1;
          activeEvaluationGeneration = 0;
          evaluating = false;
          api.hush();
          running = false;
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
          const commandId = crypto.randomUUID();
          desiredEnabled = true;
          lastAppliedCommandKey = "update:" + commandId;
          updateButtons();
          latestDesiredEvaluation = {
            code: stagedCode,
            preparedAudio: prepareAudio(),
            restart: true,
            revision: stagedRevision,
          };
          queueEvaluation(latestDesiredEvaluation);
          send({
            code: stagedCode,
            commandId,
            revision: stagedRevision,
            type: "run-request",
          });
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
