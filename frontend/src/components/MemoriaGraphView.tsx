import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  Clock,
  Filter,
  Layers,
  Link2,
  Pause,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
  FileText,
} from 'lucide-react';
import { api } from '../api/client';
import type { MemoriaGraphData, MemoriaNode } from '../types';

const CATEGORY_COLORS: Record<string, string> = {
  Entity: '#38bdf8', // Cyan
  Facts: '#ef4444', // Red
  Episodes: '#22c55e', // Green
  Entities: '#a855f7', // Purple
  Daily: '#ec4899', // Pink
  Zettels: '#f59e0b', // Amber
  General: '#94a3b8', // Slate
};

interface SimNode extends MemoriaNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

interface SimLink {
  source: SimNode;
  target: SimNode;
  kind: string;
  weight: number;
  label?: string;
}

export function MemoriaGraphView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [data, setData] = useState<MemoriaGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Controls state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [timePreset, setTimePreset] = useState<'all' | '7d' | '30d'>('all');



  // Display Sliders
  const [showArrows, setShowArrows] = useState(false);
  const [textThreshold, setTextThreshold] = useState(1.2);
  const [nodeSizeScale, setNodeSizeScale] = useState(1.0);
  const [linkThicknessScale, setLinkThicknessScale] = useState(1.0);
  const [isAnimated, setIsAnimated] = useState(true);

  // Forces Sliders
  const [centerForce, setCenterForce] = useState(0.05);
  const [repelForce, setRepelForce] = useState(120);
  const [linkForce, setLinkForce] = useState(0.08);

  // Selection & Hover
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);

  // Pan & Zoom
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggedNodeRef = useRef<SimNode | null>(null);

  // Simulation Nodes & Links
  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);
  const animFrameRef = useRef<number | null>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let startDate: string | undefined = undefined;
      if (timePreset === '7d') {
        startDate = new Date(Date.now() - 7 * 86400000).toISOString();
      } else if (timePreset === '30d') {
        startDate = new Date(Date.now() - 30 * 86400000).toISOString();
      }

      const res = await api.getMemoriaGraph({
        category: selectedCategory !== 'All' ? selectedCategory : undefined,
        type: selectedType !== 'All' ? selectedType : undefined,
        query: searchQuery.trim() || undefined,
        start_date: startDate,
      });
      setData(res);

      if (res.error) {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch graph data');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, selectedType, searchQuery, timePreset]);


  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Initialize simulation nodes & edges when data arrives
  useEffect(() => {
    if (!data || !data.nodes) return;

    const width = canvasRef.current?.clientWidth || 900;
    const height = canvasRef.current?.clientHeight || 600;

    const nodeMap = new Map<string, SimNode>();

    const simNodes: SimNode[] = data.nodes.map((n: MemoriaNode, idx: number) => {

      const angle = (idx / Math.max(1, data.nodes.length)) * 2 * Math.PI;
      const radius = 100 + Math.random() * 200;
      const color = CATEGORY_COLORS[n.category] || CATEGORY_COLORS.General;
      const nodeRadius = n.kind === 'entity' ? 7 : Math.min(12, 4 + (n.valency || 1) * 1.5);

      const sn: SimNode = {
        ...n,
        x: n.x ?? width / 2 + Math.cos(angle) * radius,
        y: n.y ?? height / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        radius: nodeRadius,
        color,
      };
      nodeMap.set(n.id, sn);
      return sn;
    });

    const simLinks: SimLink[] = [];
    for (const edge of data.edges) {
      const srcId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const tgtId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const src = nodeMap.get(srcId);
      const tgt = nodeMap.get(tgtId);
      if (src && tgt) {
        simLinks.push({
          source: src,
          target: tgt,
          kind: edge.kind,
          weight: edge.weight,
          label: edge.label,
        });
      }
    }

    simNodesRef.current = simNodes;
    simLinksRef.current = simLinks;

    // Reset center transform
    transformRef.current = { x: width / 2, y: height / 2, k: 1 };
  }, [data]);

  // Main Physics & Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const tickPhysics = () => {
      if (!isAnimated && !draggedNodeRef.current) return;

      const nodes = simNodesRef.current;
      const links = simLinksRef.current;

      // 1. Center force
      for (const n of nodes) {
        if (n === draggedNodeRef.current) continue;
        n.vx -= n.x * centerForce * 0.05;
        n.vy -= n.y * centerForce * 0.05;
      }

      // 2. Repel force (N^2 Coulomb)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          let dx = n2.x - n1.x;
          let dy = n2.y - n1.y;
          let distSq = dx * dx + dy * dy || 1;
          const dist = Math.sqrt(distSq);
          if (dist < 400) {
            const force = (repelForce * 10) / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            if (n1 !== draggedNodeRef.current) {
              n1.vx -= fx;
              n1.vy -= fy;
            }
            if (n2 !== draggedNodeRef.current) {
              n2.x += fx;
              n2.y += fy;
            }
          }
        }
      }

      // 3. Link spring force
      for (const l of links) {
        const src = l.source;
        const tgt = l.target;
        let dx = tgt.x - src.x;
        let dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = 80;
        const force = (dist - targetDist) * linkForce * 0.1;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (src !== draggedNodeRef.current) {
          src.vx += fx;
          src.vy += fy;
        }
        if (tgt !== draggedNodeRef.current) {
          tgt.vx -= fx;
          tgt.vy -= fy;
        }
      }

      // 4. Update positions with damping
      const damping = 0.85;
      for (const n of nodes) {
        if (n === draggedNodeRef.current) continue;
        n.vx *= damping;
        n.vy *= damping;
        n.x += n.vx;
        n.y += n.vy;
      }
    };

    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      // Dark background with subtle graph grid
      ctx.fillStyle = '#0b0f17';
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      const { x, y, k } = transformRef.current;
      ctx.translate(x, y);
      ctx.scale(k, k);

      const nodes = simNodesRef.current;
      const links = simLinksRef.current;
      const activeNode = hoveredNode || selectedNode;

      // Connected set for highlighting
      const connectedNodeIds = new Set<string>();
      if (activeNode) {
        connectedNodeIds.add(activeNode.id);
        for (const l of links) {
          if (l.source.id === activeNode.id) connectedNodeIds.add(l.target.id);
          if (l.target.id === activeNode.id) connectedNodeIds.add(l.source.id);
        }
      }

      // Draw Edges
      for (const l of links) {
        const isHighlighted =
          activeNode && (l.source.id === activeNode.id || l.target.id === activeNode.id);

        ctx.beginPath();
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(l.target.x, l.target.y);

        if (isHighlighted) {
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = (2 + l.weight) * linkThicknessScale;
          ctx.globalAlpha = 0.9;
        } else if (activeNode) {
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 0.5 * linkThicknessScale;
          ctx.globalAlpha = 0.15;
        } else {
          ctx.strokeStyle = l.kind === 'cooccurrence' ? 'rgba(56, 189, 248, 0.25)' : 'rgba(148, 163, 184, 0.25)';
          ctx.lineWidth = Math.min(3, 0.8 * l.weight) * linkThicknessScale;
          ctx.globalAlpha = 0.6;
        }

        ctx.stroke();
        ctx.globalAlpha = 1;

        // Draw Arrows if enabled
        if (showArrows && l.source !== l.target) {
          const angle = Math.atan2(l.target.y - l.source.y, l.target.x - l.source.x);
          const headLen = 6;
          const arrowX = l.target.x - (l.target.radius * nodeSizeScale + 2) * Math.cos(angle);
          const arrowY = l.target.y - (l.target.radius * nodeSizeScale + 2) * Math.sin(angle);

          ctx.beginPath();
          ctx.moveTo(arrowX, arrowY);
          ctx.lineTo(
            arrowX - headLen * Math.cos(angle - Math.PI / 6),
            arrowY - headLen * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            arrowX - headLen * Math.cos(angle + Math.PI / 6),
            arrowY - headLen * Math.sin(angle + Math.PI / 6)
          );
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }
      }

      // Draw Nodes
      for (const n of nodes) {
        const isSelected = selectedNode?.id === n.id;
        const isHovered = hoveredNode?.id === n.id;
        const isConnected = connectedNodeIds.has(n.id);

        const r = n.radius * nodeSizeScale;

        // Dim unconnected nodes if active node selected/hovered
        if (activeNode && !isConnected) {
          ctx.globalAlpha = 0.15;
        } else {
          ctx.globalAlpha = 1;
        }

        // Glow ring for active/selected
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 5, 0, 2 * Math.PI);
          ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.35)' : 'rgba(255, 255, 255, 0.25)';
          ctx.fill();
        }

        // Consolidation warning ring (dashed amber)
        if (n.needs_consolidation) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4, 0, 2 * Math.PI);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Node Circle
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = n.color;
        ctx.fill();
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255,255,255,0.4)';
        ctx.stroke();


        // Node Label text
        if (k * textThreshold > 0.8 || isConnected || isHovered || isSelected) {
          ctx.font = `${Math.max(10, 11 / Math.sqrt(k))}px Inter, sans-serif`;
          ctx.fillStyle = isSelected ? '#ffffff' : isConnected ? '#e2e8f0' : '#94a3b8';
          ctx.textAlign = 'center';
          ctx.fillText(n.label, n.x, n.y + r + 12);
        }
      }

      ctx.restore();

      if (running) {
        tickPhysics();
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      running = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [
    isAnimated,
    centerForce,
    repelForce,
    linkForce,
    showArrows,
    textThreshold,
    nodeSizeScale,
    linkThicknessScale,
    hoveredNode,
    selectedNode,
  ]);

  // Event Handlers for Drag, Pan & Zoom
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const { x, y, k } = transformRef.current;
    return {
      x: (mouseX - x) / k,
      y: (mouseY - y) / k,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);
    const nodes = simNodesRef.current;

    // Check hit node
    let hit: SimNode | null = null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = coords.x - n.x;
      const dy = coords.y - n.y;
      if (dx * dx + dy * dy <= n.radius * n.radius * 2.5) {
        hit = n;
        break;
      }
    }

    if (hit) {
      draggedNodeRef.current = hit;
      setSelectedNode(hit);
    } else {
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX - transformRef.current.x, y: e.clientY - transformRef.current.y };
      setSelectedNode(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);

    if (draggedNodeRef.current) {
      draggedNodeRef.current.x = coords.x;
      draggedNodeRef.current.y = coords.y;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
      return;
    }

    if (isDraggingRef.current) {
      transformRef.current.x = e.clientX - dragStartRef.current.x;
      transformRef.current.y = e.clientY - dragStartRef.current.y;
      return;
    }

    // Hover detection
    const nodes = simNodesRef.current;
    let hit: SimNode | null = null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = coords.x - n.x;
      const dy = coords.y - n.y;
      if (dx * dx + dy * dy <= n.radius * n.radius * 2.5) {
        hit = n;
        break;
      }
    }
    setHoveredNode(hit);
  };

  const handleMouseUp = () => {
    draggedNodeRef.current = null;
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const { x, y, k } = transformRef.current;
    const newK = Math.max(0.15, Math.min(5, k * zoomFactor));

    transformRef.current = {
      x: mouseX - (mouseX - x) * (newK / k),
      y: mouseY - (mouseY - y) * (newK / k),
      k: newK,
    };
  };

  const getConnectedNeighbors = (nodeId: string) => {
    const neighbors: { node: SimNode; relation: string }[] = [];
    const nodeMap = new Map<string, SimNode>(simNodesRef.current.map((n: SimNode) => [n.id, n]));
    for (const l of simLinksRef.current) {
      if (l.source.id === nodeId) {
        const tgt = nodeMap.get(l.target.id);
        if (tgt) neighbors.push({ node: tgt, relation: l.kind });
      } else if (l.target.id === nodeId) {
        const src = nodeMap.get(l.source.id);
        if (src) neighbors.push({ node: src, relation: l.kind });
      }
    }
    return neighbors;
  };


  return (
    <div className="relative flex h-full w-full overflow-hidden bg-[#0b0f17] text-gray-200">
      {/* ── Left Sidebar Controls ── */}
      <aside className="z-10 flex w-72 shrink-0 flex-col border-r border-white/10 bg-slate-950/80 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-cyan-400" />
            <h2 className="text-sm font-semibold text-white">Memoria Graph</h2>
          </div>
          <button
            type="button"
            onClick={fetchGraph}
            disabled={loading}
            className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
            title="Refresh Graph"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-5 p-4 text-xs">
          {/* Search Filter */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 font-medium text-gray-400">
              <Search className="h-3.5 w-3.5 text-cyan-400" /> Search Nodes
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search memories or entities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-white/5 py-1.5 pl-3 pr-8 text-xs text-white placeholder-gray-500 focus:border-cyan-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-2 text-gray-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Time-Travel Preset Filter */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 font-medium text-gray-400">
              <Clock className="h-3.5 w-3.5 text-cyan-400" /> Time-Travel Filter
            </label>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1">
              {[
                { id: 'all', label: 'All Time' },
                { id: '7d', label: 'Last 7D' },
                { id: '30d', label: 'Last 30D' },
              ].map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setTimePreset(preset.id as 'all' | '7d' | '30d')}
                  className={`rounded py-1 text-[11px] font-medium transition-colors ${
                    timePreset === preset.id
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Consolidation Warning Card */}
          {(data?.consolidation_warnings_count || 0) > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-300">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                <span className="font-semibold text-[11px]">
                  {data?.consolidation_warnings_count} Aged Episodic Memories
                </span>
              </div>
              <p className="text-[10px] text-amber-200/80 leading-relaxed mb-2">
                Episodic memories older than 7 days can be consolidated into semantic facts.
              </p>
            </div>
          )}

          {/* Groups & Category Filters */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 font-medium text-gray-400">
              <Filter className="h-3.5 w-3.5 text-cyan-400" /> Categories / Groups
            </label>
            <div className="flex flex-wrap gap-1">
              {['All', 'Entity', 'Facts', 'Episodes', 'Daily'].map((cat) => {
                const color = CATEGORY_COLORS[cat] || '#38bdf8';
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                      isSelected
                        ? 'bg-cyan-500/20 text-white ring-1 ring-cyan-400'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {cat !== 'All' && (
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                    )}
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>


          {/* Memory Type Filter */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 font-medium text-gray-400">
              <Layers className="h-3.5 w-3.5 text-cyan-400" /> Memory Type
            </label>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-1">
              {['All', 'semantic', 'episodic'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelectedType(t)}
                  className={`rounded py-1 text-[11px] font-medium capitalize transition-colors ${
                    selectedType === t ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Display Options */}
          <div className="border-t border-white/10 pt-4 space-y-3">
            <div className="flex items-center justify-between font-semibold text-gray-300">
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400" /> Display
              </span>
              <button
                type="button"
                onClick={() => setIsAnimated(!isAnimated)}
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${
                  isAnimated ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                }`}
              >
                {isAnimated ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {isAnimated ? 'Animate' : 'Paused'}
              </button>
            </div>

            <div className="flex items-center justify-between text-gray-400">
              <span>Show Arrows</span>
              <input
                type="checkbox"
                checked={showArrows}
                onChange={(e) => setShowArrows(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-0"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Node Size</span>
                <span>{nodeSizeScale.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.1"
                value={nodeSizeScale}
                onChange={(e) => setNodeSizeScale(parseFloat(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Link Thickness</span>
                <span>{linkThicknessScale.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.1"
                value={linkThicknessScale}
                onChange={(e) => setLinkThicknessScale(parseFloat(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Text Threshold</span>
                <span>{textThreshold.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.1"
                value={textThreshold}
                onChange={(e) => setTextThreshold(parseFloat(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>
          </div>

          {/* Forces Tuning */}
          <div className="border-t border-white/10 pt-4 space-y-3">
            <span className="font-semibold text-gray-300">Forces Tuning</span>

            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Center Force</span>
                <span>{centerForce.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="0.2"
                step="0.01"
                value={centerForce}
                onChange={(e) => setCenterForce(parseFloat(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Repel Force</span>
                <span>{repelForce}</span>
              </div>
              <input
                type="range"
                min="20"
                max="300"
                step="10"
                value={repelForce}
                onChange={(e) => setRepelForce(parseInt(e.target.value, 10))}
                className="w-full accent-cyan-400"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>Link Force</span>
                <span>{linkForce.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="0.3"
                step="0.01"
                value={linkForce}
                onChange={(e) => setLinkForce(parseFloat(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>
          </div>
        </div>

        {/* Status Bar footer */}
        <div className="border-t border-white/10 px-4 py-2.5 text-[11px] text-gray-500 flex justify-between items-center">
          <span>{data?.node_count || 0} nodes</span>
          <span>{data?.edge_count || 0} edges</span>
          <span>{data?.cluster_count || 0} clusters</span>
        </div>

      </aside>

      {/* ── Main Graph Canvas ── */}
      <main className="relative flex-1">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-cyan-400">
              <RefreshCw className="h-7 w-7 animate-spin" />
              <span className="text-xs font-medium">Loading Memoria Graph...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute top-4 left-4 right-4 z-20 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
            <strong>Graph Error:</strong> {error}
          </div>
        )}

        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          className="h-full w-full cursor-grab active:cursor-grabbing"
        />

        {/* Hover / Click Instruction Pill */}
        <div className="absolute bottom-4 left-4 z-10 rounded-full border border-white/10 bg-slate-950/70 px-3 py-1.5 text-[11px] text-gray-400 backdrop-blur-md">
          Scroll to zoom • Drag background to pan • Click node to inspect details
        </div>
      </main>

      {/* ── Right Node Inspector Slide-over ── */}
      {selectedNode && (
        <aside className="z-20 w-80 shrink-0 border-l border-white/10 bg-slate-950/90 p-5 backdrop-blur-lg flex flex-col space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: selectedNode.color }}
              />
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                {selectedNode.kind}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div>
            <h3 className="text-base font-bold text-white mb-1">{selectedNode.label}</h3>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded bg-white/10 px-2 py-0.5 text-gray-300">
                Category: {selectedNode.category}
              </span>
              {selectedNode.importance && (
                <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-cyan-300 font-medium capitalize">
                  {selectedNode.importance}
                </span>
              )}
            </div>
          </div>

          {selectedNode.content && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-gray-300 space-y-1">
              <span className="font-semibold text-gray-400 block text-[11px]">Content Preview</span>
              <p className="leading-relaxed font-mono text-[11px]">{selectedNode.content}</p>
            </div>
          )}

          {selectedNode.vault_path && (
            <div className="text-xs text-gray-400 flex items-center gap-1.5 truncate">
              <FileText className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
              <span className="truncate">{selectedNode.vault_path}</span>
            </div>
          )}

          {/* Connected Backlinks / Neighbors */}
          <div className="flex-1 overflow-y-auto border-t border-white/10 pt-3 space-y-2">
            <span className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5 text-cyan-400" /> Connected Connections (
              {getConnectedNeighbors(selectedNode.id).length})
            </span>

            <div className="space-y-1.5">
              {getConnectedNeighbors(selectedNode.id).map(({ node: neighbor, relation }) => (
                <button
                  key={neighbor.id}
                  type="button"
                  onClick={() => setSelectedNode(neighbor)}
                  className="flex w-full items-center justify-between rounded-lg border border-white/5 bg-white/5 p-2 text-left text-xs transition-colors hover:bg-cyan-500/10 hover:border-cyan-500/30"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: neighbor.color }}
                    />
                    <span className="truncate text-gray-200">{neighbor.label}</span>
                  </div>
                  <span className="text-[10px] text-gray-500 font-mono capitalize">{relation}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
