import { notFound } from "next/navigation";

import { ExpiredRoom } from "@/components/expired-room";
import { PlayHtmlProvider } from "@/components/play-html-provider";
import { VideoChatApp } from "@/components/video-chat-app";
import { VideoReconnectPreview } from "@/components/video-reconnect-preview";
import { getRoomDisplayName, isValidRoomId } from "@/lib/room-directory";

interface RoomPageProps {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{
    name?: string | string[];
    preview?: string | string[];
  }>;
}

export default async function RoomPage({ params, searchParams }: RoomPageProps) {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) notFound();

  const { name, preview } = await searchParams;
  const requestedPreview = Array.isArray(preview) ? preview[0] : preview;
  if (requestedPreview === "expired") return <ExpiredRoom />;

  const requestedName = Array.isArray(name) ? name[0] : name;
  const roomName = getRoomDisplayName(roomId, requestedName);

  if (requestedPreview === "video-reconnecting") {
    return (
      <PlayHtmlProvider>
        <VideoReconnectPreview roomName={roomName} />
      </PlayHtmlProvider>
    );
  }

  return (
    <PlayHtmlProvider>
      <VideoChatApp roomName={roomName} />
    </PlayHtmlProvider>
  );
}
