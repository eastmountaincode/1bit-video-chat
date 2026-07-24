export function RoomUnavailable() {
  return (
    <main className="splash-page">
      <div className="room-status">
        <fieldset>
          <legend>Telepathy</legend>

          <p>The room server is unavailable.</p>

          <p>
            <a href="">Reload</a>
          </p>

          <p className="room-back-link">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/">
              <span aria-hidden="true">←</span> Back to room selection
            </a>
          </p>
        </fieldset>
      </div>
    </main>
  );
}
