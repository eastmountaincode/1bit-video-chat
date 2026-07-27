import { notFound } from "next/navigation";

import { ExpiredRoom } from "@/components/expired-room";
import { PlayHtmlProvider } from "@/components/play-html-provider";
import { RoomUnavailable } from "@/components/room-unavailable";
import { VideoChatApp } from "@/components/video-chat-app";
import { isValidRoomId } from "@/lib/room-directory";
import {
  getPublicRoom,
  getRegisteredRoomParticipantCount,
} from "@/lib/redis-room-registry";

export const dynamic = "force-dynamic";

interface RoomPageProps {
  params: Promise<{ roomId: string }>;
}

export default async function RoomPage({ params }: RoomPageProps) {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) notFound();

  let room;
  let participantCount;
  try {
    room = await getPublicRoom(roomId);
    participantCount = room
      ? await getRegisteredRoomParticipantCount(roomId)
      : null;
  } catch (error) {
    console.error("Could not open the room.", error);
    return <RoomUnavailable />;
  }
  if (!room || participantCount === null) return <ExpiredRoom />;

  return (
    <PlayHtmlProvider>
      <VideoChatApp
        initialParticipantCount={participantCount}
        roomId={room.id}
        roomName={room.name}
      />
    </PlayHtmlProvider>
  );
}
