'use client';

import dynamic from 'next/dynamic';
import { useMemo, useEffect, useRef, useState } from 'react';
import type { GraphNode, GraphLink } from '@/lib/types';
import { useLanguage } from './LanguageProvider';

// ВАЖНО: именно 2D-пакет
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
});

interface Props {
  graph: {
    nodes: GraphNode[];
    links: GraphLink[];
  };
  rootAddress?: string;
}

export default function GraphView({ graph, rootAddress }: Props) {
  const { t } = useLanguage();

  // ----- готовим данные для графа -----
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({
        ...n,
        id: n.id,
      })),
      links: graph.links.map((l) => ({
        ...l,
        source: l.source,
        target: l.target,
      })),
    }),
    [graph],
  );

  // ----- следим за размером контейнера -----
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl">
      <h2 className="text-lg font-semibold px-2 pt-1 pb-2">{t.graph.title}</h2>

      {/* Контейнер фиксированной высоты, в нём будет граф */}
      <div
        ref={containerRef}
        className="h-96 w-full overflow-hidden rounded-lg"
      >
        {size.width > 0 && size.height > 0 && (
          <ForceGraph2D
            width={size.width}
            height={size.height}
            graphData={data}
            nodeRelSize={6}
            // linkDirectionalParticles={2}
            // linkDirectionalParticleSpeed={0.005}
            linkColor={() => 'rgba(148, 163, 184, 0.5)'}
            backgroundColor="#020617"
            nodeCanvasObject={(node: any, ctx, globalScale) => {
              const label = node.label || node.id;
              const fontSize = 10 / globalScale;

              const isRoot = rootAddress && node.id === rootAddress;
              const isSuspicious = node.isSuspicious;

              const radius = isRoot ? 8 : 5;

              ctx.beginPath();
              ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
              ctx.fillStyle = isRoot
                ? '#22c55e' // корневой адрес
                : isSuspicious
                ? '#f97373' // подозрительный
                : '#e5e7eb'; // обычный
              ctx.fill();

              ctx.font = `${fontSize}px Sans-Serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = '#cbd5f5';
              ctx.fillText(label, node.x, node.y + radius + 2);
            }}
          />
        )}
      </div>

      <p className="mt-2 text-xs text-slate-400 px-2">
        {t.graph.legend}
      </p>
    </div>
  );
}
