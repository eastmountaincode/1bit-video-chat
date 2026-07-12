import { PlayHtmlProvider } from "@/components/play-html-provider";
import { VideoChatApp } from "@/components/video-chat-app";

export default function Home() {
  return (
    <PlayHtmlProvider>
      <VideoChatApp />
    </PlayHtmlProvider>
  );
}
