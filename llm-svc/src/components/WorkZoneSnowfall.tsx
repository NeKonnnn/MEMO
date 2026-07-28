import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';

type Flake = {
  x: number;
  y: number;
  vy: number;
  phase: number;
  sway: number;
  r: number;
  opacity: number;
  angle: number;
  spin: number;
  /** true — простая снежинка-звёздочка, false — мягкий кружок */
  detailed: boolean;
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

function drawSnowflake(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = Math.max(0.4, r * 0.12);
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r * 1.35);
    ctx.stroke();
    ctx.rotate(Math.PI / 3);
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.fill();
  ctx.restore();
}

/**
 * Тёмно-синее небо и плавно падающие снежинки (лёгкое покачивание по горизонтали).
 */
export default function WorkZoneSnowfall({ isDarkMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let flakes: Flake[] = [];
    let lastW = 0;
    let lastH = 0;
    let raf = 0;
    let lastTs = performance.now();
    let rnd = mulberry32(0x9e3779b9);

    function buildFlakes(w: number, h: number) {
      rnd = mulberry32((w << 16) ^ h ^ 0xdecafbad);
      const area = w * h;
      const count = Math.min(130, Math.max(56, Math.floor(area / 10000)));
      const out: Flake[] = [];
      for (let i = 0; i < count; i++) {
        out.push({
          x: rnd() * w,
          y: rnd() * (h + 80) - 40,
          vy: 0.35 + rnd() * 0.85,
          phase: rnd() * Math.PI * 2,
          sway: 0.35 + rnd() * 1.1,
          r: 1.8 + rnd() * 3.2,
          opacity: 0.35 + rnd() * 0.55,
          angle: rnd() * Math.PI * 2,
          spin: (rnd() - 0.5) * 0.012,
          detailed: rnd() > 0.55,
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
        flakes = buildFlakes(w, h);
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

    const respawn = (f: Flake, w: number) => {
      f.x = rnd() * w;
      f.y = -15 - rnd() * 40;
      f.vy = 0.35 + rnd() * 0.85;
      f.phase = rnd() * Math.PI * 2;
      f.sway = 0.35 + rnd() * 1.1;
      f.r = 1.8 + rnd() * 3.2;
      f.opacity = 0.35 + rnd() * 0.55;
      f.angle = rnd() * Math.PI * 2;
      f.spin = (rnd() - 0.5) * 0.012;
      f.detailed = rnd() > 0.55;
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

      if (isDarkMode) {
        const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
        g.addColorStop(0, '#070f22');
        g.addColorStop(0.45, '#0c1832');
        g.addColorStop(1, '#0a1428');
        ctx.fillStyle = g;
      } else {
        const g = ctx.createLinearGradient(0, 0, w, h * 0.9);
        g.addColorStop(0, '#1a2d4a');
        g.addColorStop(0.55, '#152540');
        g.addColorStop(1, '#0f1c33');
        ctx.fillStyle = g;
      }
      ctx.fillRect(0, 0, w, h);

      for (const f of flakes) {
        const swayX = Math.sin(t * f.sway + f.phase) * 12;
        f.y += f.vy * dt;
        f.x += swayX * 0.04 * dt;
        f.angle += f.spin * dt;

        if (f.y > h + 20) {
          respawn(f, w);
        }
        if (f.x < -30) f.x = w + 20;
        if (f.x > w + 30) f.x = -20;

        if (f.detailed) {
          drawSnowflake(ctx, f.x, f.y, f.r, f.angle, f.opacity);
        } else {
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * 0.45, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${f.opacity * 0.9})`;
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [isDarkMode]);

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
