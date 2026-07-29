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
        const MAX_CODE_LENGTH = 10000;
        const SAMPLE_CATALOGS = ${JSON.stringify(STRUDEL_SAMPLE_CATALOGS)};
        const runButton = document.querySelector("#run");
        const stopButton = document.querySelector("#stop");
        let canRun = false;
        let controlsDisabled = true;
        let evaluating = false;
        let evaluationGeneration = 0;
        let evaluationError = null;
        let initialized = false;
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
          runButton.textContent = running ? "update" : "run";
          runButton.disabled =
            !initialized ||
            controlsDisabled ||
            evaluating ||
            !canRun ||
            !stagedCode.trim();
          stopButton.disabled = !initialized || controlsDisabled || !running;
          stopButton.hidden = !running;
        }

        const api = globalThis.strudel;
        if (
          !api ||
          typeof api.initStrudel !== "function" ||
          typeof api.initAudio !== "function" ||
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

        async function evaluatePattern(code, revision, restart) {
          if (
            evaluating ||
            controlsDisabled ||
            !canRun ||
            !code.trim()
          ) {
            return;
          }

          const generation = ++evaluationGeneration;
          const wasRunning = running;
          let restarted = false;
          evaluating = true;
          evaluationError = null;
          updateButtons();

          try {
            await initialization;
            await api.initAudio();
            await loadSampleCatalogs();
            if (generation !== evaluationGeneration) return;
            if (restart) {
              api.hush();
              restarted = true;
            }
            await api.evaluate(code);
            if (evaluationError) {
              throw new Error(evaluationError);
            }
            if (generation !== evaluationGeneration) return;
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
            if (generation !== evaluationGeneration) {
              api.hush();
            }
            evaluating = false;
            updateButtons();
          }
        }

        function stopPattern() {
          evaluationGeneration += 1;
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

          if (command.type === "stop") {
            stopPattern();
            return;
          }
          if (
            (command.type !== "stage" && command.type !== "update") ||
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

          if (command.type === "update") {
            void evaluatePattern(
              command.code,
              command.revision,
              false,
            );
          }
        });

        runButton.addEventListener("click", () => {
          if (runButton.disabled) return;
          void evaluatePattern(stagedCode, stagedRevision, true);
        });

        stopButton.addEventListener("click", () => {
          if (stopButton.disabled) return;
          stopPattern();
        });

        updateButtons();
      })();
    </script>
  </body>
</html>`;
