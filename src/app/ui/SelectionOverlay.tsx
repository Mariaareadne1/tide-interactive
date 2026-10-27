import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { TideApp } from '../TideApp';
import { useAppState } from '../../state/store';
import { CM_PER_M } from '../../scene/beach';
import { Icon, type IconName } from './icons';

/**
 * MEADOW's thin blue box around the selected crab with a real-unit readout,
 * and a small contextual bar of its three actions. Positions are written
 * straight to the DOM every frame — no React renders.
 */

export function SelectionOverlay({ app }: { app: TideApp }) {
  const selection = useAppState(app.store, (s) => s.selection);
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selection) return;
    const box3 = new THREE.Box3();
    const corner = new THREE.Vector3();
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const update = () => {
      const box = boxRef.current;
      const bar = barRef.current;
      const crab = app.beach.get(selection.id);
      if (!box || !bar || !crab) return;
      crab.view.bounds(box3);
      const cam = app.engine.camera;
      const rect = app.rect;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? box3.max.x : box3.min.x, i & 2 ? box3.max.y : box3.min.y, i & 4 ? box3.max.z : box3.min.z).project(cam);
        const sx = ((corner.x + 1) / 2) * rect.width;
        const sy = ((1 - corner.y) / 2) * rect.height;
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
      const pad = 6;
      box.style.transform = `translate(${(minX - pad).toFixed(1)}px, ${(minY - pad).toFixed(1)}px)`;
      box.style.width = `${(maxX - minX + pad * 2).toFixed(1)}px`;
      box.style.height = `${(maxY - minY + pad * 2).toFixed(1)}px`;
      box3.getSize(size);
      box3.getCenter(centre);
      if (labelRef.current) {
        const w = Math.max(size.x, size.z) * CM_PER_M, h = size.y * CM_PER_M;
        const dist = cam.position.distanceTo(centre) * CM_PER_M / 100;
        labelRef.current.textContent = `${w.toFixed(1)} × ${h.toFixed(1)} cm  ·  ${dist.toFixed(1)} m away`;
      }
      // the bar sits under the box, or above it near the bottom edge
      const barW = bar.offsetWidth;
      const barH = bar.offsetHeight;
      const cx = Math.min(rect.width - barW / 2 - 12, Math.max(barW / 2 + 12, (minX + maxX) / 2));
      const below = maxY + pad + 34 + barH < rect.height - 84;
      const y = below ? maxY + pad + 30 : minY - pad - barH - 12;
      bar.style.transform = `translate(${(cx - barW / 2).toFixed(1)}px, ${Math.max(8, y).toFixed(1)}px)`;
    };
    update();
    return app.engine.onBeforeRender(update);
  }, [app, selection]);

  if (!selection) return null;
  return (
    <>
      <div className="select-box" ref={boxRef} aria-hidden="true">
        <i className="h tl" /><i className="h tr" /><i className="h bl" /><i className="h br" />
        <span className="select-label" ref={labelRef} />
      </div>
      <div className="action-bar" ref={barRef} role="toolbar" aria-label="Selected crab" data-kind="crab">
        <CrabBar app={app} id={selection.id} />
      </div>
    </>
  );
}

function Chip({ label, title, on, onClick, icon }: { label: string; title?: string; on?: boolean; onClick: () => void; icon: IconName }) {
  return (
    <button className={on ? 'chip on' : 'chip'} title={title ?? label} aria-pressed={on} onClick={onClick}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

function CrabBar({ app, id }: { app: TideApp; id: number }) {
  // re-render when any crab's mode changes
  useAppState(app.store, (s) => s.crabTick);
  const c = app.beach.get(id)?.controller;
  if (!c) return null;
  const following = c.lineId !== null || c.waitingForLine;
  const buried = c.mode === 'burrowed';
  const dancing = app.beach.dancing;
  return (
    <>
      <span className="bar-title">Crab</span>
      <Chip label="Follow a line" icon="follow" title="Follow a line (F)" on={following} onClick={() => app.followLine(id)} />
      <Chip label="Wave" icon="wave" title="Wave (W)" onClick={() => app.waveClaws(id)} />
      <Chip label={buried ? 'Come out' : 'Burrow'} icon="burrow" title="Burrow / come out (B)" on={buried} onClick={() => app.toggleBurrow(id)} />
      <span className="sep" />
      <Chip label="Dance" icon="dance" title="Everyone lines up and dances (D)" on={dancing} onClick={() => app.dance()} />
    </>
  );
}
