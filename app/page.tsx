"use client";
import { useState } from 'react';
import dynamic from 'next/dynamic';

const GameCanvas = dynamic(() => import('@components/GameCanvas'), { ssr: false });

export default function HomePage() {
  const [showHelp, setShowHelp] = useState(true);
  return (
    <main className="container">
      <header className="header">
        <h1>Vent Nightmare</h1>
        <div className="actions">
          <button onClick={() => setShowHelp(v => !v)}>{showHelp ? 'Hide' : 'Show'} Help</button>
          <a className="deploy" href="https://agentic-b2409366.vercel.app" target="_blank" rel="noreferrer">Live</a>
        </div>
      </header>
      {showHelp && (
        <section className="panel">
          <h2>How to Play</h2>
          <ul>
            <li>WASD or Arrow Keys to move</li>
            <li>Shift to sprint, Space to toggle crawl speed</li>
            <li>Mouse to aim flashlight</li>
            <li>Find the exit vent before the Stalker finds you</li>
          </ul>
        </section>
      )}
      <GameCanvas />
      <footer className="footer">? {new Date().getFullYear()} Vent Nightmare</footer>
    </main>
  );
}
