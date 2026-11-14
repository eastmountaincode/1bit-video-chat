import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "About · Telepathy" };

export default function AboutPage() {
    return (
        <main className="about-page">
            <Link href="/">← Back</Link>
            <h1>Telepathy</h1>
            <p>A low-resolution video chat space you can change together.</p>
            <p>
                Create a room, share the link, and turn on your camera. Chat,
                edit the room&apos;s CSS, or run a Hydra sketch behind the video.
                Everyone in the room shares the same space.
            </p>
            <p>
                Built with <a href="https://playhtml.fun/">PlayHTML</a> and{" "}
                <a href="https://hydra.ojack.xyz/">Hydra</a>.
            </p>
        </main>
    );
}
