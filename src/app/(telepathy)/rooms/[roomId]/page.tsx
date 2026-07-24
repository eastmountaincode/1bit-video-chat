import { notFound } from "next/navigation";

import { ExpiredRoom } from "@/components/expired-room";
import { PlayHtmlProvider } from "@/components/play-html-provider";
import { RoomUnavailable } from "@/components/room-unavailable";
import { VideoChatApp } from "@/components/video-chat-app";
import { isValidRoomId } from "@/lib/room-directory";
import { getPublicRoom } from "@/lib/redis-room-registry";

export const dynamic = "force-dynamic";

interface RoomPageProps {
  params: Promise<{ roomId: string }>;
}

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) notFound();

  let room;
  try {
    room = await getPublicRoom(roomId);
  } catch (error) {
    console.error("Could not open the room.", error);
    return <RoomUnavailable />;
  }
  if (!room) return <ExpiredRoom />;

  return (
    <PlayHtmlProvider>
      <VideoChatApp roomId={room.id} roomName={room.name} />
    </PlayHtmlProvider>
  );
}
