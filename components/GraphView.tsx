// components/GraphView.tsx
import type { GraphNode, GraphLink } from '@/lib/types';

interface Props {
  graph: {
    nodes: GraphNode[];
    links: GraphLink[];
  };
}

export default function GraphView({ graph }: Props) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-2">
      <h2 className="text-lg font-semibold">Граф связей</h2>

      <p className="text-xs text-slate-400">
        Упрощённое представление графа: список адресов и связей между ними. В реальном
        проекте можно подключить библиотеку для визуализации (D3, react-force-graph и т.п.).
      </p>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <h3 className="font-medium mb-1">Узлы</h3>
          <ul className="space-y-1 max-h-40 overflow-auto pr-2">
            {graph.nodes.map((node) => (
              <li key={node.id}>
                <span
                  className={
                    node.isSuspicious ? 'text-red-400 font-semibold' : 'text-slate-200'
                  }
                >
                  {node.label}
                </span>{' '}
                <span className="text-slate-400">
                  (risk: {node.riskScore.toFixed(1)})
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-medium mb-1">Связи</h3>
          <ul className="space-y-1 max-h-40 overflow-auto pr-2">
            {graph.links.map((link, i) => (
              <li key={i} className="text-slate-200">
                {link.source} → {link.target}{' '}
                <span className="text-slate-400">(tx: {link.txCount})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
