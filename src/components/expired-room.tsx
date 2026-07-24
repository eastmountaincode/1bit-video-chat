export function ExpiredRoom() {
  return (
    <main className="splash-page">
      <div className="room-status">
        <fieldset>
          <legend>Telepathy</legend>

          <p>This room has expired.</p>

          <p className="room-back-link">
            {/* A document navigation cannot carry this room's PlayHTML transport into the lobby. */}
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
