import { useEffect, useRef, useState } from 'react';

/**
 * Iki kapi, kesisen wifi dalgalari ve buyuyen zincir.
 *
 * Metafor dogrudan urunun kendisi: kapilar internetsiz calisir, birbirinden
 * habersizdir. Dalgalar kesistiginde — yani gecisler senkronize edildiginde —
 * zincire bir halka eklenir. Halka sayisi belli bir boya ulasinca zincir
 * yenilenir (etkinlik kapanisi).
 */

type Wave = { born: number };
type Link = { born: number };

const WAVE_PERIOD = 1900;   // ms — iki kapi da bu araliklarla dalga yayar
const WAVE_SPEED = 0.075;   // px/ms
const MAX_LINKS = 9;
const FADE_MS = 700;

export default function GateChain({ label = 'doğrulanmış geçiş' }: { label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [count, setCount] = useState(0);
  const countRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c2d = canvas.getContext('2d');
    if (!c2d) return;
    const ctx = c2d; // daraltilmis tip: ic fonksiyonlar null kontrolunu tekrar etmesin

    let raf = 0;
    let waves: Wave[] = [];
    let links: Link[] = [];
    let lastWave = 0;
    let lastMeet = 0;
    let resetAt = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    /** ESP32 karti — kucuk bir devre karti silueti. */
    function drawBoard(x: number, y: number, name: string, live: boolean) {
      const w = 46;
      const h = 30;
      ctx.save();
      ctx.translate(x - w / 2, y - h / 2);

      ctx.fillStyle = '#131a24';
      ctx.strokeStyle = live ? 'rgba(63,185,80,.75)' : '#2b3440';
      ctx.lineWidth = 1;
      roundRect(ctx, 0, 0, w, h, 5);
      ctx.fill();
      ctx.stroke();

      // anten
      ctx.fillStyle = '#1c2430';
      roundRect(ctx, w - 15, 4, 11, 9, 2);
      ctx.fill();
      // yonga
      ctx.fillStyle = '#243040';
      roundRect(ctx, 8, 9, 16, 13, 2);
      ctx.fill();
      // pinler
      ctx.fillStyle = '#2b3440';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(5 + i * 6, h - 3, 3, 3);
        ctx.fillRect(5 + i * 6, 0, 3, 3);
      }
      // durum ledi
      ctx.fillStyle = live ? '#3fb950' : '#233';
      ctx.beginPath();
      ctx.arc(w - 9, h - 8, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#6b7684';
      ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(name, x, y + h / 2 + 15);
    }

    /** Bir zincir halkasi — dik ve yatik halkalar birbirine geciyor. */
    function drawLink(x: number, y: number, i: number, alpha: number, fresh: number) {
      const rx = i % 2 === 0 ? 13 : 7.5;
      const ry = i % 2 === 0 ? 7.5 : 13;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3;
      if (fresh > 0) {
        ctx.shadowColor = 'rgba(63,185,80,.9)';
        ctx.shadowBlur = 16 * fresh;
        ctx.strokeStyle = `rgba(${mix(230, 63, fresh)},${mix(237, 185, fresh)},${mix(243, 80, fresh)},1)`;
      } else {
        ctx.strokeStyle = 'rgba(200,212,224,.85)';
      }
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const frame = (now: number) => {
      ctx.clearRect(0, 0, width, height);

      const gy = height * 0.33;
      const leftX = width * 0.26;
      const rightX = width * 0.74;
      const gap = rightX - leftX;
      const meetMs = (gap / 2) / WAVE_SPEED;

      if (now - lastWave > WAVE_PERIOD) {
        waves.push({ born: now });
        lastWave = now;
      }

      // Dalgalar
      for (const w of waves) {
        const age = now - w.born;
        const r = age * WAVE_SPEED;
        const fade = Math.max(0, 1 - r / (gap * 0.78));
        if (fade <= 0) continue;
        for (const x of [leftX, rightX]) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(88,166,255,${0.42 * fade})`;
          ctx.lineWidth = 1.4;
          ctx.arc(x, gy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Kesisme ani
        const meet = age - meetMs;
        if (meet >= 0 && meet < 520) {
          const k = 1 - meet / 520;
          const my = gy;
          const mx = (leftX + rightX) / 2;
          ctx.beginPath();
          ctx.fillStyle = `rgba(63,185,80,${0.5 * k})`;
          ctx.arc(mx, my, 4 + 16 * (1 - k), 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.strokeStyle = `rgba(63,185,80,${0.8 * k})`;
          ctx.lineWidth = 1.6;
          ctx.arc(mx, my, 6 + 26 * (1 - k), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      waves = waves.filter((w) => (now - w.born) * WAVE_SPEED < gap * 0.85);

      // Kesisim zincire halka ekler
      if (now - lastMeet > WAVE_PERIOD && waves.some((w) => now - w.born >= meetMs && now - w.born < meetMs + 60)) {
        lastMeet = now;
        if (links.length >= MAX_LINKS) {
          resetAt = now;
          links = [];
          countRef.current = 0;
        }
        links.push({ born: now });
        countRef.current += 1;
        setCount(countRef.current);
      }

      drawBoard(leftX, gy, 'KAPI M307', true);
      drawBoard(rightX, gy, 'KAPI M308', true);

      // Zincir
      const cy = height * 0.72;
      const step = 19;
      const total = links.length;
      const startX = width / 2 - ((total - 1) * step) / 2;
      links.forEach((l, i) => {
        const age = now - l.born;
        const fresh = Math.max(0, 1 - age / 900);
        const appear = Math.min(1, age / 240);
        drawLink(startX + i * step, cy, i, appear, fresh);
      });

      if (resetAt && now - resetAt < FADE_MS) {
        const k = 1 - (now - resetAt) / FADE_MS;
        ctx.fillStyle = `rgba(63,185,80,${0.12 * k})`;
        ctx.fillRect(0, 0, width, height);
      }

      // Zincir yoksa ipucu cizgisi
      if (total === 0) {
        ctx.strokeStyle = 'rgba(43,52,64,.7)';
        ctx.setLineDash([3, 6]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(width * 0.3, cy);
        ctx.lineTo(width * 0.7, cy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="chainviz">
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="chainviz-meta">
        <span className="n">{count}</span>
        <span className="l">{label}</span>
      </div>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const mix = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
