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

/** The word "hi" in a loose hand, about 0.6 m wide, as three strokes (the dot is a tiny one). */
export function word(size = 1) {
  const h1 = [];
  for (let i = 0; i <= 14; i++) h1.push([-0.3 + Math.sin(i * 0.4) * 0.006, -0.3 + (i / 14) * 0.58]);
  const h2 = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    if (t < 0.55) {
      const a = Math.PI - (t / 0.55) * Math.PI;
      h2.push([-0.3 + 0.13 + 0.13 * Math.cos(a), 0.06 - 0.14 * Math.sin(a)]);
    } else h2.push([-0.04, 0.06 + ((t - 0.55) / 0.45) * 0.22]);
  }
  const i1 = [];
  for (let i = 0; i <= 10; i++) i1.push([0.16, -0.04 + (i / 10) * 0.32]);
  const dot = [[0.155, -0.2], [0.17, -0.19], [0.16, -0.18]];
  return [h1, h2, i1, dot].map((st) => st.map(([x, z]) => [x * size, z * size]));
}
