"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { EssentialVariant } from "./EssentialVariant";
import { JourneyVariant } from "./JourneyVariant";
import { SpacesVariant } from "./SpacesVariant";
import { scenarios, type Scenario } from "./model";

const variants = [
  { name: "Essentiel", Component: EssentialVariant },
  { name: "Parcours", Component: JourneyVariant },
  { name: "Espaces", Component: SpacesVariant },
];

export function Prototype({ initialVariant }: { initialVariant: number }) {
  const [variant, setVariant] = useState(initialVariant);
  const [scenario, setScenario] = useState<Scenario>("dossier");
  const [replay, setReplay] = useState(0);
  const picker = useRef<HTMLElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const Component = variants[variant].Component;

  function choose(index: number) {
    setVariant(index);
    setReplay((value) => value + 1);
    const url = new URL(window.location.href);
    url.searchParams.set("v", String(index + 1));
    window.history.replaceState(null, "", url);
  }
  useLayoutEffect(() => {
    function move() {
      const item = picker.current?.querySelectorAll<HTMLButtonElement>(".proto-picker-item")[variant];
      if (item && highlight.current) {
        highlight.current.style.width = `${item.offsetWidth}px`;
        highlight.current.style.transform = `translateX(${item.offsetLeft}px)`;
      }
    }
    move();
    window.addEventListener("resize", move);
    return () => window.removeEventListener("resize", move);
  }, [variant]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => picker.current?.setAttribute("data-ready", "")));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (event.metaKey || event.ctrlKey || event.altKey || !(target instanceof HTMLElement) || target.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      const number = Number(event.key);
      if (number >= 1 && number <= variants.length) choose(number - 1);
      else if (event.key === "ArrowRight") { event.preventDefault(); choose((variant + 1) % variants.length); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); choose((variant + variants.length - 1) % variants.length); }
      else if (event.key.toLowerCase() === "r") setReplay((value) => value + 1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant]);

  return <div className="pc-prototype">
    <div className="pc-lab"><div><strong>Exploration du pilotage</strong><span>Maquettes · données fictives · actions simulées</span></div>
      <label>Situation de l’affaire<select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    </div>
    <Component key={`${variant}-${scenario}-${replay}`} scenario={scenario} advance={setScenario} />
    <nav ref={picker} className="proto-picker" aria-label="Prototype variants"><span ref={highlight} className="proto-picker-highlight" aria-hidden="true" />
      {variants.map((item, index) => <button key={item.name} className="proto-picker-item" data-active={variant === index ? "" : undefined} aria-current={variant === index ? "true" : undefined} onClick={() => choose(index)}>{item.name}</button>)}
    </nav>
  </div>;
}
