import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "About · Telepathy" };

export default function AboutPage() {
    return (
        <main className="about-page">
            <Link className="about-back-link" href="/">← Back</Link>
            <header className="about-header lobby-header">
                <Image
                    alt=""
                    className="lobby-mark"
                    height={40}
                    priority
                    src="/icon.svg"
                    width={40}
                />
                <h1>Telepathy</h1>
            </header>
            <p>
                Telepathy is lofi video chat, customizable per room using CSS and{" "}
                <a href="https://hydra.ojack.xyz/">Hydra</a>.
            </p>
            <p>
                Created in July 2026 during Spencer Chang&apos;s{" "}
                <a href="https://spencer.place/creation/building-benches-for-the-web/">
                    Building Benches for the Web
                </a>{" "}
                SFPC class.
            </p>
            <p>Made by <a href="https://andrew-boylan.com/">Andrew</a>.</p>
        </main>
    );
}
