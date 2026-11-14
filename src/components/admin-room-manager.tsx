"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { MAIN_ROOM, type PublicRoomListing } from "@/lib/room-directory";
import styles from "@/app/admin/page.module.css";

export function AdminRoomManager({ authenticated }: { authenticated: boolean }) {
    const [signedIn, setSignedIn] = useState(authenticated);
    const [rooms, setRooms] = useState<PublicRoomListing[] | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [refresh, setRefresh] = useState(0);
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
    const revision = useRef(0);
    const cancelButton = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (confirmId) cancelButton.current?.focus();
    }, [confirmId]);

    useEffect(() => {
        if (!signedIn) return;
        let stopped = false;
        let inFlight = false;
        const controller = new AbortController();
        async function loadRooms() {
            if (stopped || inFlight || document.visibilityState === "hidden") return;
            inFlight = true;
            const requestRevision = revision.current;
            try {
                const response = await fetch("/api/admin/rooms", {
                    cache: "no-store",
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
                });
                if (stopped || requestRevision !== revision.current) return;
                if (response.status === 401) {
                    setSignedIn(false);
                    setRooms(null);
                    setError("Your session has expired. Please sign in again.");
                    return;
                }
                const body = await response.json();
                if (stopped || requestRevision !== revision.current) return;
                if (!response.ok) throw new Error(body.error ?? "Could not load rooms.");
                setRooms(body.rooms);
                setUpdatedAt(new Date());
                setError("");
            } catch (cause) {
                if (!stopped && requestRevision === revision.current) {
                    setError(cause instanceof Error && cause.name !== "TimeoutError"
                        ? cause.message : "Could not refresh rooms. Try again.");
                }
            } finally {
                inFlight = false;
            }
        }
        void loadRooms();
        const timer = window.setInterval(() => void loadRooms(), 10000);
        const onVisible = () => void loadRooms();
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            stopped = true;
            controller.abort();
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [signedIn, refresh]);

    async function mutate(url: string, method: string, password?: string) {
        const response = await fetch(url, {
            method,
            headers: password === undefined ? undefined : { "Content-Type": "application/json" },
            body: password === undefined ? undefined : JSON.stringify({ password }),
            signal: AbortSignal.timeout(15000),
        });
        const body = await response.json();
        if (!response.ok) {
            if (response.status === 401 && signedIn) {
                setSignedIn(false);
                setRooms(null);
            }
            throw new Error(body.error ?? "Something went wrong. Try again.");
        }
    }

    async function signIn(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const form = event.currentTarget;
        const password = String(new FormData(form).get("password") ?? "");
        setBusy(true);
        setError("");
        try {
            await mutate("/api/admin/session", "POST", password);
            form.reset();
            setSignedIn(true);
            setNotice("");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not sign in.");
        } finally {
            setBusy(false);
        }
    }

    async function signOut() {
        setBusy(true);
        setError("");
        try {
            await mutate("/api/admin/session", "DELETE");
            revision.current += 1;
            setSignedIn(false);
            setRooms(null);
            setConfirmId(null);
            setNotice("");
        } catch {
            setError("Could not sign out. Try again.");
        } finally {
            setBusy(false);
        }
    }

    async function deleteRoom(room: PublicRoomListing) {
        if (busy) return;
        setBusy(true);
        setError("");
        revision.current += 1;
        try {
            await mutate(`/api/admin/rooms/${encodeURIComponent(room.id)}`, "DELETE");
            revision.current += 1;
            setRooms((current) => current?.filter((item) => item.id !== room.id) ?? null);
            setConfirmId(null);
            setNotice(`Deleted “${room.name}”.`);
            setRefresh((value) => value + 1);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not delete this room.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <header className={styles.header}>
                <div>
                    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                    <a href="/">Telepathy</a>
                    <h1>Room manager</h1>
                </div>
                {signedIn && <button onClick={() => void signOut()} disabled={busy}>Sign out</button>}
            </header>
            {!signedIn ? (
                <form className={styles.login} onSubmit={signIn}>
                    <label htmlFor="admin-password">
                        Password
                        <input id="admin-password" name="password" type="password" autoComplete="current-password" required maxLength={256} />
                    </label>
                    <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
                    {error && <p className={styles.error} role="alert">{error}</p>}
                </form>
            ) : (
                <>
                    <div className={styles.toolbar}>
                        <p>{rooms ? `${rooms.length} rooms · ${rooms.reduce((total, room) => total + room.participantCount, 0)} people online` : "Loading rooms…"}</p>
                        <button onClick={() => setRefresh((value) => value + 1)} disabled={busy}>Refresh</button>
                    </div>
                    <p className={styles.muted}>
                        Updates every 10 seconds.{updatedAt && ` Last updated ${updatedAt.toLocaleTimeString()}.`}
                    </p>
                    {error && <p className={styles.error} role="alert">{error}</p>}
                    <p className={styles.notice} role="status">{notice}</p>
                    <ul className={styles.rooms} aria-label="Rooms">
                        {rooms?.map((room) => (
                            <li className={styles.room} key={room.id}>
                                <div>
                                    <h2>{room.name}</h2>
                                    <p className={styles.muted}>
                                        {room.createdAt === 0 ? "Permanent room" : <time dateTime={new Date(room.createdAt).toISOString()}>Created {new Date(room.createdAt).toLocaleString()}</time>}
                                    </p>
                                </div>
                                <div className={`${styles.count} ${room.participantCount ? styles.active : styles.muted}`}>
                                    {room.participantCount ? `${room.participantCount} / ${room.capacity} online` : "Empty"}
                                </div>
                                <div className={styles.actions}>
                                    <a href={`/rooms/${room.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${room.name} in a new tab`}>Open room ↗</a>
                                    {room.id === MAIN_ROOM.id ? <span className={`${styles.muted} ${styles.protected}`}>Protected</span> : (
                                        <button className={styles.delete} disabled={busy} onClick={() => { setConfirmId(room.id); setNotice(""); }} aria-label={`Delete ${room.name}`}>Delete</button>
                                    )}
                                </div>
                                {confirmId === room.id && (
                                    <div className={styles.confirmation}>
                                        <p>Delete “{room.name}”? Its link will stop working and anyone inside will be disconnected. This cannot be undone.</p>
                                        <div className={styles.actions}>
                                            <button ref={cancelButton} disabled={busy} onClick={() => setConfirmId(null)}>Cancel</button>
                                            <button className={styles.delete} disabled={busy} onClick={() => void deleteRoom(room)}>{busy ? "Deleting…" : "Delete room"}</button>
                                        </div>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </>
    );
}
