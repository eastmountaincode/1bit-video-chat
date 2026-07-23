import { notFound } from "next/navigation";

import { VideoChatApp } from "@/components/video-chat-app";
import { getRoomDisplayName, isValidRoomId } from "@/lib/room-directory";

interface RoomPageProps {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ name?: string | string[] }>;
}

export default async function RoomPage({ params, searchParams }: RoomPageProps) {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) notFound();

  const { name } = await searchParams;
  const requestedName = Array.isArray(name) ? name[0] : name;

  return (
    <VideoChatApp
      roomName={getRoomDisplayName(roomId, requestedName)}
    />
  );
}
