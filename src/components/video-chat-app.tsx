"use client";

import { useEffect, useRef, useState } from "react";

import { JoinSplash } from "@/components/join-splash";
import { VideoRoom } from "@/components/video-room";
import { useCamera } from "@/hooks/use-camera";
import {
  admitRoomParticipant,
  createRoomParticipantId,
  getRoomParticipantCount,
  leaveRoomParticipant,
  useRoomParticipant,
} from "@/hooks/use-room-participant";
import {
  ROOM_PARTICIPANT_CAPACITY,
} from "@/lib/room-directory";
import { ROOM_LIST_REFRESH_MS } from "@/lib/room-lifecycle";

interface VideoChatAppProps {
  initialParticipantCount: number;
  roomId: string;
  roomName: string;
}

interface JoinedParticipant {
  id: string;
  name: string;
}

export function VideoChatApp({
  initialParticipantCount,
  roomId,
  roomName,
}: VideoChatAppProps) {
  const { permission, requestCamera, stream } = useCamera();
  const joinParticipantIdRef = useRef<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [participant, setParticipant] =
    useState<JoinedParticipant | null>(null);
  const [participantCount, setParticipantCount] = useState(
    initialParticipantCount,
  );

  function leaveRoom() {
    // Unload every camera and PlayHTML transport before returning to the lobby.
    if (participant) {
      void leaveRoomParticipant(roomId, participant.id);
    }
    window.location.assign("/");
  }

  async function joinRoom(name: string) {
    if (isJoining || participant) return;
    setIsJoining(true);
    setJoinError(null);

    const participantId =
      joinParticipantIdRef.current ?? createRoomParticipantId();
    joinParticipantIdRef.current = participantId;
    const result = await admitRoomParticipant(roomId, participantId);

    if (result.participantCount !== null) {
      setParticipantCount(result.participantCount);
    }
    if (result.ok) {
      setParticipant({ id: participantId, name });
    } else {
      setJoinError(result.error ?? "The room could not be joined.");
    }
    setIsJoining(false);
  }

  useRoomParticipant({
    onMembershipLost: (message) => {
      setParticipant(null);
      setJoinError(message);
    },
    onParticipantCount: setParticipantCount,
    participantId: participant?.id ?? null,
    roomId,
  });

  useEffect(() => {
    if (participant) return;

    let requestInFlight = false;
    let stopped = false;

    async function refreshParticipantCount() {
      if (requestInFlight || stopped) return;
      requestInFlight = true;
      const result = await getRoomParticipantCount(roomId);
      requestInFlight = false;
      if (stopped) return;

      if (result.participantCount !== null) {
        setParticipantCount(result.participantCount);
      }
      if (result.status === 410) window.location.reload();
    }

    function refreshVisibleParticipantCount() {
      if (document.visibilityState === "visible") {
        void refreshParticipantCount();
      }
    }

    const refreshTimer = window.setInterval(
      refreshVisibleParticipantCount,
      ROOM_LIST_REFRESH_MS,
    );
    window.addEventListener("focus", refreshVisibleParticipantCount);
    document.addEventListener(
      "visibilitychange",
      refreshVisibleParticipantCount,
    );

    return () => {
      stopped = true;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshVisibleParticipantCount);
      document.removeEventListener(
        "visibilitychange",
        refreshVisibleParticipantCount,
      );
    };
  }, [participant, roomId]);

  if (participant && stream) {
    return (
      <VideoRoom
        name={participant.name}
        onLeave={leaveRoom}
        roomName={roomName}
        stream={stream}
      />
    );
  }

  return (
    <JoinSplash
      capacity={ROOM_PARTICIPANT_CAPACITY}
      error={joinError}
      isJoining={isJoining}
      onJoin={joinRoom}
      participantCount={participantCount}
      permission={permission}
      requestCamera={requestCamera}
      roomName={roomName}
      stream={stream}
    />
  );
}
