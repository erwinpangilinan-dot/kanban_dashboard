import { useState } from 'react';
import { Brain, FileText } from 'lucide-react';
import { MemoriaGraphView } from './MemoriaGraphView';
import { MemoriaProceduresPanel } from './MemoriaProceduresPanel';

type MemoriaTab = 'graph' | 'procedures';

export function MemoriaPage() {
  const [tab, setTab] = useState<MemoriaTab>('graph');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-white/5 bg-surface-glass px-4 py-2">
        <button
          type="button"
          onClick={() => setTab('graph')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'graph'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'text-gray-400 hover:bg-surface-overlay hover:text-gray-200'
          }`}
        >
          <Brain className="h-3.5 w-3.5" />
          Graph
        </button>
        <button
          type="button"
          onClick={() => setTab('procedures')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === 'procedures'
              ? 'bg-accent/15 text-accent-hover border border-accent/30'
              : 'text-gray-400 hover:bg-surface-overlay hover:text-gray-200'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          Procedures (MOP)
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'graph' ? <MemoriaGraphView /> : <MemoriaProceduresPanel />}
      </div>
    </div>
  );
}
