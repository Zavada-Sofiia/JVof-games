import { useEffect, useState, type RefObject } from 'react';

/**
 * Підбирає кількість колонок і розмір плиток так, щоб N плиток з пропорцією aspect
 * вмістилися в контейнер без прокрутки й без накладання (як у Zoom/Meet).
 * На вузьких екранах повертає null — тоді працює звичайна CSS-сітка з прокруткою.
 */
export function useFitGrid(ref: RefObject<HTMLElement | null>, count: number, aspect = 4 / 3, gap = 10, maxTile = 520) {
  const [layout, setLayout] = useState<{ cols: number; width: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (window.innerWidth <= 960 || W < 200 || H < 150 || count === 0) {
        setLayout(null);
        return;
      }
      let best = { cols: 1, width: 0 };
      for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const byWidth = (W - gap * (cols - 1)) / cols;
        const byHeight = ((H - gap * (rows - 1)) / rows) * aspect;
        const width = Math.min(byWidth, byHeight, maxTile);
        if (width > best.width) best = { cols, width };
      }
      setLayout({ cols: best.cols, width: Math.floor(best.width) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [ref, count, aspect, gap, maxTile]);

  return layout;
}
