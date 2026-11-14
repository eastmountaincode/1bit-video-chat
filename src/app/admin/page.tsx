import type { Metadata } from "next";

import { AdminRoomManager } from "@/components/admin-room-manager";
import { isAdminAuthenticated } from "@/lib/admin-auth";

import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
    title: "Room manager · Telepathy",
    robots: { index: false, follow: false },
};

export default async function AdminPage() {
    return (
        <main className={styles.page}>
            <AdminRoomManager authenticated={await isAdminAuthenticated()} />
        </main>
    );
}
