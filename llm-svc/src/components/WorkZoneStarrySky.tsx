import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';

/** Те же поля и движение, что у WorkZoneSnowfall — только отрисовка точек, без снежинок */
type StarDot = {
  x: number;
  y: number;
  vy: number;
  phase: number;
  sway: number;
  r: number;
  opacity: number;
};

type Props = {
  isDarkMode: boolean;
};

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Чёрное небо и падающие «звёздочки» — физика как у снегопада (вниз + покачивание), только точки без хвоста.
 */
export default function WorkZoneStarrySky(_props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dots: StarDot[] = [];
    let lastW = 0;
    let lastH = 0;
    let raf = 0;
    let lastTs = performance.now();
    let rnd = mulberry32(0x5f3759df);

    function buildDots(w: number, h: number) {
      rnd = mulberry32((w << 16) ^ h ^ 0xcafebabe);
      const area = w * h;
      const count = Math.min(130, Math.max(56, Math.floor(area / 10000)));
      const out: StarDot[] = [];
      for (let i = 0; i < count; i++) {
        out.push({
          x: rnd() * w,
          y: rnd() * (h + 80) - 40,
          vy: 0.35 + rnd() * 0.85,
          phase: rnd() * Math.PI * 2,
          sway: 0.35 + rnd() * 1.1,
          r: 1.8 + rnd() * 3.2,
          opacity: 0.35 + rnd() * 0.55,
        });
      }
      return out;
    }

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 2 || h < 2) return;
      if (w !== lastW || h !== lastH) {
        lastW = w;
        lastH = h;
        dots = buildDots(w, h);
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const respawn = (d: StarDot, w: number) => {
      d.x = rnd() * w;
      d.y = -15 - rnd() * 40;
      d.vy = 0.35 + rnd() * 0.85;
      d.phase = rnd() * Math.PI * 2;
      d.sway = 0.35 + rnd() * 1.1;
      d.r = 1.8 + rnd() * 3.2;
      d.opacity = 0.35 + rnd() * 0.55;
    };

    const draw = (ts: number) => {
      const w = lastW;
      const h = lastH;
      if (w < 2 || h < 2) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const dt = Math.min(40, ts - lastTs) / 16.67;
      lastTs = ts;
      const t = ts * 0.001;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      for (const d of dots) {
        const swayX = Math.sin(t * d.sway + d.phase) * 12;
        d.y += d.vy * dt;
        d.x += swayX * 0.04 * dt;

        if (d.y > h + 20) {
          respawn(d, w);
        }
        if (d.x < -30) d.x = w + 20;
        if (d.x > w + 30) d.x = -20;

        const radius = d.r * 0.45;
        const a = d.opacity * 0.9;

        ctx.beginPath();
        ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} aria-hidden />
    </Box>
  );
}
