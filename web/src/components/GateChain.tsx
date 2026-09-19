import { useEffect, useRef, useState } from 'react';

/**
 * Sahnenin arka plan katmani: iki kapi, kesisen wifi dalgalari, buyuyen zincir.
 *
 * Kutu yok — sayfanin kendi zemini uzerine ciziyor. Dalgalar sagdaki telefonun
 * arkasindan gecip soner. Metafor dogrudan urunun kendisi: kapilar birbirinden
 * habersiz calisir; dalgalar kesistiginde, yani gecisler senkronize edildiginde,
 * zincire bir halka eklenir.
 */

type Wave = { born: number };
type Link = { born: number };

const WAVE_PERIOD = 1500; // ms — iki kapi da bu araliklarla dalga yayar
const WAVE_SPEED = 0.09;  // px/ms
const MAX_LINKS = 9;

export default function GateChain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [count, setCount] = useState(0);
  const countRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const c2d = canvas.getContext('2d');
    if (!c2d) return;
    const ctx = c2d; // daraltilmis tip

    let raf = 0;
    let waves: Wave[] = [];
    let links: Link[] = [];
    let lastWave = 0;
    let lastMeet = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, width * dpr);
      canvas.height = Math.max(1, height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    /** Sade bir ESP32 silueti — cok detaya girmiyor, uzaktan kart gibi okunuyor. */
    function drawBoard(x: number, y: number, name: string) {
      const w = 46;
      const h = 30;
      ctx.save();
      ctx.translate(x - w / 2, y - h / 2);
      ctx.fillStyle = '#10141b';
      ctx.strokeStyle = 'rgba(63,185,80,.55)';
      ctx.lineWidth = 1;
      roundRect(ctx, 0, 0, w, h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1b2430';
      roundRect(ctx, 8, 8, 17, 14, 2);   // yonga
      ctx.fill();
      roundRect(ctx, w - 14, 5, 10, 8, 2); // anten
      ctx.fill();
      ctx.fillStyle = '#3fb950';
      ctx.beginPath();
      ctx.arc(w - 8, h - 8, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = 'rgba(125,135,148,.85)';
      ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(name, x, y + h / 2 + 16);
    }

    function drawLink(x: number, y: number, i: number, alpha: number, fresh: number) {
      const rx = i % 2 === 0 ? 15 : 8.5;
      const ry = i % 2 === 0 ? 8.5 : 15;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2.8;
      if (fresh > 0) {
        ctx.shadowColor = 'rgba(63,185,80,.9)';
        ctx.shadowBlur = 14 * fresh;
        ctx.strokeStyle = `rgba(${mix(190, 63, fresh)},${mix(202, 185, fresh)},${mix(214, 80, fresh)},1)`;
      } else {
        ctx.strokeStyle = 'rgba(150,162,176,.6)';
      }
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const frame = (now: number, schedule = true) => {
      ctx.clearRect(0, 0, width, height);

      // Kapilar sahnenin solunda; dalgalar saga dogru acilip telefonun
      // arkasindan geciyor.
      const gy = height * 0.60;
      const leftX = width * 0.12;
      const rightX = width * 0.30;
      const gap = rightX - leftX;
      const meetMs = gap / 2 / WAVE_SPEED;
      const reach = width * 1.25; // telefonun arkasindan gecip soner

      if (now - lastWave > WAVE_PERIOD) {
        waves.push({ born: now });
        lastWave = now;
      }

      for (const w of waves) {
        const age = now - w.born;
        const r = age * WAVE_SPEED;
        const fade = Math.max(0, 1 - r / reach);
        if (fade <= 0) continue;
        for (const x of [leftX, rightX]) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(88,166,255,${0.34 * fade})`;
          ctx.lineWidth = 1.3;
          ctx.arc(x, gy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        const meet = age - meetMs;
        if (meet >= 0 && meet < 560) {
          const k = 1 - meet / 560;
          const mx = (leftX + rightX) / 2;
          ctx.beginPath();
          ctx.fillStyle = `rgba(63,185,80,${0.45 * k})`;
          ctx.arc(mx, gy, 3 + 14 * (1 - k), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      waves = waves.filter((w) => (now - w.born) * WAVE_SPEED < reach);

      if (now - lastMeet > WAVE_PERIOD &&
          waves.some((w) => now - w.born >= meetMs && now - w.born < meetMs + 70)) {
        lastMeet = now;
        if (links.length >= MAX_LINKS) {
          links = [];
          countRef.current = 0;
        }
        links.push({ born: now });
        countRef.current += 1;
        setCount(countRef.current);
      }

      drawBoard(leftX, gy, 'M307');
      drawBoard(rightX, gy, 'M308');

      // Zincir kapilarin hemen altinda
      const cx = (leftX + rightX) / 2;
      const cy = gy + 100;
      const step = 21;
      const startX = cx - ((links.length - 1) * step) / 2;
      links.forEach((l, i) => {
        const age = now - l.born;
        drawLink(startX + i * step, cy, i, Math.min(1, age / 240), Math.max(0, 1 - age / 900));
      });

      if (links.length === 0) {
        ctx.strokeStyle = 'rgba(30,35,44,.9)';
        ctx.setLineDash([3, 6]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 70, cy);
        ctx.lineTo(cx + 70, cy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Sayac zincirin altinda — DOM'da degil, hep hizali kalsin diye burada.
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(63,185,80,.95)';
      ctx.font = '650 19px -apple-system, system-ui, sans-serif';
      ctx.fillText(String(countRef.current), cx - 46, cy + 46);
      ctx.fillStyle = 'rgba(84,93,105,.95)';
      ctx.font = '400 11.5px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('zincire yazılan geçiş', cx - 36, cy + 46);

      if (schedule) raf = requestAnimationFrame(frame);
    };

    // Hata ayiklama: "?t=7000" ile animasyon o ana kadar sarilip tek kare
    // cizilir. Headless tarayicida requestAnimationFrame ilerlemedigi icin
    // kompozisyonu boyle dogruluyoruz.
    const freeze = Number(new URLSearchParams(window.location.search).get('t'));
    if (Number.isFinite(freeze) && freeze > 0) {
      const render = () => {
        waves = [];
        links = [];
        lastWave = 0;
        lastMeet = 0;
        countRef.current = 0;
        for (let t = 0; t <= freeze; t += 16) frame(t, false);
      };
      render();
      // Olcu degisince tuval temizlenir; dondurulmus kareyi yeniden ciz.
      ro.disconnect();
      const ro2 = new ResizeObserver(() => { resize(); render(); });
      ro2.observe(canvas);
      return () => ro2.disconnect();
    }

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // `count` yalnizca yeniden cizime neden olmasi icin durumda tutuluyor;
  // sayi canvas uzerinde, zincirle hizali cizilir.
  void count;
  return (
    <div className="chainviz">
      <canvas ref={canvasRef} aria-hidden="true" />
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
