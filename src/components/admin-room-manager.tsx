"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";

import { MAIN_ROOM, type PublicRoomListing } from "@/lib/room-directory";
import styles from "@/app/admin/page.module.css";

export function AdminRoomManager({ authenticated }: { authenticated: boolean }) {
    const [signedIn, setSignedIn] = useState(authenticated);
    const [rooms, setRooms] = useState<PublicRoomListing[] | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [confirmAllIds, setConfirmAllIds] = useState<string[] | null>(null);
    const [refresh, setRefresh] = useState(0);
    const revision = useRef(0);
    const cancelButton = useRef<HTMLButtonElement>(null);
    const removableIds = rooms?.filter((room) => room.id !== MAIN_ROOM.id).map((room) => room.id) ?? [];

    useEffect(() => {
        if (confirmId || confirmAllIds) cancelButton.current?.focus();
    }, [confirmId, confirmAllIds]);

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
                    setConfirmId(null);
                    setConfirmAllIds(null);
                    setError("Your session has expired. Please sign in again.");
                    return;
                }
                const body = await response.json();
                if (stopped || requestRevision !== revision.current) return;
                if (!response.ok) throw new Error(body.error ?? "Could not load rooms.");
                setRooms(body.rooms);
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

    async function mutate(url: string, method: string, data?: Record<string, unknown>) {
        const response = await fetch(url, {
            method,
            headers: data === undefined ? undefined : { "Content-Type": "application/json" },
            body: data === undefined ? undefined : JSON.stringify(data),
            signal: AbortSignal.timeout(15000),
        });
        const body = await response.json();
        if (!response.ok) {
            if (response.status === 401 && signedIn) {
                setSignedIn(false);
                setRooms(null);
                setConfirmId(null);
                setConfirmAllIds(null);
            }
            throw new Error(body.error ?? "Something went wrong. Try again.");
        }
        return body;
    }

    async function signIn(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        const form = event.currentTarget;
        const password = String(new FormData(form).get("password") ?? "");
        setBusy(true);
        setError("");
        try {
            await mutate("/api/admin/session", "POST", { password });
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
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            await mutate("/api/admin/session", "DELETE");
            revision.current += 1;
            setSignedIn(false);
            setRooms(null);
            setConfirmId(null);
            setConfirmAllIds(null);
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
            setRooms((current) => current?.filter((item) => item.id !== room.id) ?? null);
            setConfirmId(null);
            setNotice(`Deleted “${room.name}”.`);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not delete this room.");
        } finally {
            revision.current += 1;
            setRefresh((value) => value + 1);
            setBusy(false);
        }
    }

    async function deleteAllRooms() {
        if (busy || !confirmAllIds?.length) return;
        const ids = confirmAllIds;
        setBusy(true);
        setError("");
        revision.current += 1;
        try {
            const result = await mutate("/api/admin/rooms", "DELETE", { roomIds: ids });
            setRooms((current) => current?.filter((room) => !ids.includes(room.id)) ?? null);
            setConfirmAllIds(null);
            setNotice(`Deleted ${result.deleted} ${result.deleted === 1 ? "room" : "rooms"}.`);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not delete rooms.");
        } finally {
            revision.current += 1;
            setRefresh((value) => value + 1);
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
                        <p>{rooms ? `${rooms.length} rooms, ${rooms.reduce((total, room) => total + room.participantCount, 0)} online` : "Loading rooms…"}</p>
                        <div className={styles.actions}>
                            <button onClick={() => setRefresh((value) => value + 1)} disabled={busy}>Refresh</button>
                            <button className={styles.delete} disabled={busy || removableIds.length === 0} onClick={() => {
                                setConfirmId(null);
                                setConfirmAllIds(removableIds);
                                setNotice("");
                            }}>Delete all</button>
                        </div>
                    </div>
                    {error && <p className={styles.error} role="alert">{error}</p>}
                    <p className={styles.notice} role="status">{notice}</p>
                    {confirmAllIds && (
                        <div className={styles.confirmation}>
                            <p>Delete these {confirmAllIds.length} rooms? Main will stay. Anyone inside will be disconnected. This cannot be undone.</p>
                            <div className={styles.actions}>
                                <button ref={cancelButton} disabled={busy} onClick={() => setConfirmAllIds(null)}>Cancel</button>
                                <button className={styles.delete} disabled={busy} onClick={() => void deleteAllRooms()}>{busy ? "Deleting…" : "Delete rooms"}</button>
                            </div>
                        </div>
                    )}
                    <div className={styles.tableWrapper}>
                        <table className={styles.rooms} aria-label="Rooms">
                            <thead>
                                <tr>
                                    <th scope="col">Room</th>
                                    <th scope="col">Created</th>
                                    <th scope="col" className={styles.count}>Online</th>
                                    <th scope="col"><span className={styles.visuallyHidden}>Actions</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rooms?.map((room) => (
                                    <Fragment key={room.id}>
                                        <tr>
                                            <th scope="row" className={styles.name}>{room.name}</th>
                                            <td className={styles.created}>
                                                {room.createdAt === 0 ? "Permanent" : <time dateTime={new Date(room.createdAt).toISOString()}>{new Date(room.createdAt).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}</time>}
                                            </td>
                                            <td className={styles.count}>{room.participantCount} / {room.capacity}</td>
                                            <td>
                                                <div className={styles.actions}>
                                                    <a href={`/rooms/${room.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${room.name} in a new tab`}>Open</a>
                                                    {room.id === MAIN_ROOM.id ? <span className={styles.protected}>Protected</span> : (
                                                        <button className={styles.delete} disabled={busy} onClick={() => {
                                                            setConfirmAllIds(null);
                                                            setConfirmId(room.id);
                                                            setNotice("");
                                                        }} aria-label={`Delete ${room.name}`}>Delete</button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                        {confirmId === room.id && (
                                            <tr>
                                                <td colSpan={4}>
                                                    <div className={styles.confirmation}>
                                                        <p>Delete “{room.name}”? Its link will stop working and anyone inside will be disconnected. This cannot be undone.</p>
                                                        <div className={styles.actions}>
                                                            <button ref={cancelButton} disabled={busy} onClick={() => setConfirmId(null)}>Cancel</button>
                                                            <button className={styles.delete} disabled={busy} onClick={() => void deleteRoom(room)}>{busy ? "Deleting…" : "Delete room"}</button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </>
    );
}
