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
    <button disabled hidden id="stop" type="button">stop strudel</button>
    <button disabled id="run" type="button">run strudel</button>
    <script src="/strudel-web-1.3.0/index.js"></script>
    <script>
      (() => {
        const SOURCE = "telepathy-strudel";
        const MAX_CODE_LENGTH = 10000;
        const runButton = document.querySelector("#run");
        const stopButton = document.querySelector("#stop");
        let canRun = false;
        let controlsDisabled = true;
        let evaluationError = null;
        let initialized = false;
        let running = false;
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
          runButton.disabled =
            !initialized || controlsDisabled || !canRun || !stagedCode.trim();
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

        const initialization = Promise.resolve(
          api.initStrudel({
            onEvalError(error) {
              evaluationError = errorMessage(error);
            },
            prebake: () =>
              api.samples("github:tidalcycles/dirt-samples"),
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

        window.addEventListener("message", (event) => {
          const command = event.data;
          if (
            event.source !== window.parent ||
            !command ||
            command.source !== SOURCE ||
            command.type !== "stage" ||
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
        });

        runButton.addEventListener("click", async () => {
          if (runButton.disabled) return;

          const code = stagedCode;
          const revision = stagedRevision;
          runButton.disabled = true;
          evaluationError = null;

          try {
            await initialization;
            await api.initAudio();
            api.hush();
            await api.evaluate(code);
            if (evaluationError) {
              throw new Error(evaluationError);
            }
            running = true;
            send({ ok: true, revision, type: "result" });
          } catch (error) {
            running = false;
            send({
              error: errorMessage(error),
              ok: false,
              revision,
              type: "result",
            });
          } finally {
            updateButtons();
          }
        });

        stopButton.addEventListener("click", () => {
          if (stopButton.disabled) return;
          api.hush();
          running = false;
          updateButtons();
          send({ type: "stopped" });
        });

        updateButtons();
      })();
    </script>
  </body>
</html>`;
