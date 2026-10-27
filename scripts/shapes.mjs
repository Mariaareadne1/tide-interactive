// Stroke shapes in world metres, centred on (0, 0): x across the beach, z toward the camera.
// Each shape is a list of strokes (a word has several).
export function heart(size = 1) {
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const t = (i / 80) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([(x / 17) * 0.55 * size, (-y / 17) * 0.55 * size]);
  }
  return [pts];
}

export function spiral(size = 1) {
  const pts = [];
  for (let i = 0; i <= 140; i++) {
    const t = i / 140, a = t * 3 * Math.PI * 2;
    pts.push([Math.cos(a) * 0.6 * t * size, Math.sin(a) * 0.45 * t * size]);
  }
  return [pts];
}

/** The word "sea" in a loose hand, about 1.6 m long. */
export function word(size = 1) {
  const s = [];
  // s
  const sP = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const a = Math.PI * 0.2 + t * Math.PI * 2.2;
    sP.push([-0.62 + 0.13 * Math.cos(a) * (t < 0.5 ? 1 : -1), -0.2 + t * 0.4 + 0.06 * Math.sin(a)]);
  }
  s.push(sP);
  // e
  const eP = [[-0.25, 0.02], [0.0, 0.02]];
  for (let i = 0; i <= 30; i++) {
    const a = -0.1 + (i / 30) * Math.PI * 1.75;
    eP.push([-0.12 + 0.14 * Math.cos(a), 0.02 - 0.2 * Math.sin(a)]);
  }
  s.push(eP);
  // a
  const aP = [];
  for (let i = 0; i <= 30; i++) {
    const a = Math.PI * 0.25 + (i / 30) * Math.PI * 2;
    aP.push([0.33 + 0.14 * Math.cos(a), 0.02 - 0.2 * Math.sin(a)]);
  }
  aP.push([0.47, -0.2], [0.47, 0.22]);
  s.push(aP);
  return s.map((st) => st.map(([x, z]) => [x * size, z * size]));
}
