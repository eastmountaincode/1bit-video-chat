import { PlayHtmlProvider } from "@/components/play-html-provider";
import { RoomLobby } from "@/components/room-lobby";

export default function Home() {
  return (
    <PlayHtmlProvider>
      <RoomLobby />
    </PlayHtmlProvider>
  );
}
