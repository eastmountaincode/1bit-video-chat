export const HYDRA_FRAME_DOCUMENT = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      html, body {
        background: #000;
        height: 100%;
        margin: 0;
        overflow: hidden;
      }

      canvas {
        display: block;
        height: 100%;
        width: 100%;
      }
    </style>
  </head>
  <body>
    <canvas aria-hidden="true"></canvas>
    <script src="/hydra-synth-1.4.0.js"></script>
    <script>
      (() => {
        const SOURCE = "telepathy-hydra";
        const MAX_CODE_LENGTH = 10000;
        const canvas = document.querySelector("canvas");

        function send(message) {
          window.parent.postMessage({ source: SOURCE, ...message }, "*");
        }

        if (typeof window.Hydra !== "function") {
          send({
            error: "Hydra could not load.",
            ok: false,
            revision: "",
            type: "result",
          });
          return;
        }

        canvas.width = Math.max(1, Math.floor(window.innerWidth));
        canvas.height = Math.max(1, Math.floor(window.innerHeight));

        let hydra;
        try {
          hydra = new window.Hydra({
            canvas,
            detectAudio: false,
            enableStreamCapture: false,
            makeGlobal: true,
          });
        } catch (error) {
          send({
            error:
              error && typeof error.message === "string"
                ? error.message.slice(0, 500)
                : String(error).slice(0, 500),
            ok: false,
            revision: "",
            type: "result",
          });
          return;
        }

        function resize() {
          const width = Math.max(1, Math.floor(window.innerWidth));
          const height = Math.max(1, Math.floor(window.innerHeight));
          if (canvas.width === width && canvas.height === height) return;
          hydra.setResolution(width, height);
        }

        window.addEventListener("resize", resize);
        window.addEventListener("message", (event) => {
          const command = event.data;
          if (
            event.source !== window.parent ||
            !command ||
            command.source !== SOURCE ||
            command.type !== "run" ||
            typeof command.code !== "string" ||
            command.code.length > MAX_CODE_LENGTH ||
            typeof command.revision !== "string"
          ) {
            return;
          }

          try {
            hydra.hush();
            hydra.eval(command.code);
            send({
              ok: true,
              revision: command.revision,
              type: "result",
            });
          } catch (error) {
            send({
              error:
                error && typeof error.message === "string"
                  ? error.message.slice(0, 500)
                  : String(error).slice(0, 500),
              ok: false,
              revision: command.revision,
              type: "result",
            });
          }
        });

        send({ type: "ready" });
      })();
    </script>
  </body>
</html>`;
