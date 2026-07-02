"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { WorkflowNode, WorkflowEdge, NodeMetadata } from "@/lib/workflow-types";
import type { NodeValidationResult } from "@/lib/workflow-validation";
import WorkflowNodeCard from "./WorkflowNodeCard";

interface Props {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onDeleteNode: (id: string) => void;
  onMoveNode: (id: string, position: { x: number; y: number }) => void;
  onAddEdge: (sourceId: string, targetId: string, sourcePort?: string) => void;
  onDeleteEdge: (id: string) => void;
  nodeExecutionStatuses?: Record<string, "idle" | "running" | "success" | "error">;
  nodeValidations?: Record<string, NodeValidationResult>;
  onAddNode?: (metadata: NodeMetadata, position: { x: number; y: number }) => void;
}

// ── TB Layout Constants ──────────────────────────────────────────────────────
const NODE_WIDTH = 240;
const NODE_HEIGHT = 85; // Approximate card height
const PORT_RADIUS = 5;  // 10px diameter / 2

// ── Port Position Helpers (TB layout) ────────────────────────────────────────

function getSourcePortPosition(
  node: WorkflowNode,
  port: string | undefined
): { x: number; y: number } {
  const baseX = node.position.x + NODE_WIDTH / 2; // Center horizontally
  const baseY = node.position.y + NODE_HEIGHT + PORT_RADIUS - 5; // Bottom edge of node, accounting for negative margins

  if (node.category === "condition" || node.type === "loop_items") {
    if (port === "yes" || port === "loop") {
      return { x: baseX - 42, y: baseY }; // Left port (gap-16 is 64px. 32px + half text width ~42px)
    }
    if (port === "no" || port === "done") {
      return { x: baseX + 42, y: baseY }; // Right port
    }
  }
  return { x: baseX, y: baseY };
}

function getTargetPortPosition(node: WorkflowNode): { x: number; y: number } {
  return {
    x: node.position.x + NODE_WIDTH / 2, // Center horizontally
    y: node.position.y - PORT_RADIUS + 5, // Top edge of node, accounting for negative margins
  };
}

// ── SVG Edge Rendering ───────────────────────────────────────────────────────

const EdgePath = React.memo(function EdgePath({
  edge,
  sourceNode,
  targetNode,
  onDelete,
}: {
  edge: WorkflowEdge;
  sourceNode?: WorkflowNode;
  targetNode?: WorkflowNode;
  onDelete: (id: string) => void;
}) {
  if (!sourceNode || !targetNode) return null;

  const start = getSourcePortPosition(sourceNode, edge.sourcePort);
  const end = getTargetPortPosition(targetNode);

  // Vertical bezier curve (TB flow)
  const deltaY = end.y - start.y;
  
  // Smarter control point offset to prevent massive loops when nodes are placed horizontally
  const cpOffset = deltaY > 0 
    ? Math.max(60, deltaY * 0.4) 
    : Math.max(30, Math.abs(deltaY) * 0.15);

  const path = `M ${start.x} ${start.y} C ${start.x} ${start.y + cpOffset}, ${end.x} ${end.y - cpOffset}, ${end.x} ${end.y}`;

  // Edge color based on label
  let strokeColor = "#4b5563";
  if (edge.label === "Yes" || edge.sourcePort === "yes") strokeColor = "#3fb950";
  if (edge.label === "No" || edge.sourcePort === "no") strokeColor = "#f85149";
  if (edge.label === "Loop" || edge.sourcePort === "loop") strokeColor = "#a855f7";
  if (edge.label === "Done" || edge.sourcePort === "done") strokeColor = "#9ca3af";

  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  return (
    <g>
      {/* Invisible wider path for easier hover/click */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        className="cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(edge.id);
        }}
      />
      {/* Visible edge */}
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={2}
        strokeDasharray="none"
        className="transition-colors duration-200 pointer-events-none"
        opacity={0.6}
      />
      {/* Animated dot */}
      <circle r="3" fill={strokeColor} opacity={0.8}>
        <animateMotion dur="3s" repeatCount="indefinite" path={path} />
      </circle>
      {/* Arrow at end (pointing down) */}
      <polygon
        points={`${end.x},${end.y} ${end.x - 5},${end.y - 8} ${end.x + 5},${end.y - 8}`}
        fill={strokeColor}
        opacity={0.6}
      />
      {/* Label */}
      {edge.label && (
        <g>
          <rect
            x={midX - 16}
            y={midY - 9}
            width={32}
            height={18}
            rx={9}
            fill="#0d1117"
            stroke={strokeColor}
            strokeWidth={1}
            opacity={0.9}
          />
          <text
            x={midX}
            y={midY + 4}
            textAnchor="middle"
            className="text-[9px] font-medium fill-current"
            style={{ fill: strokeColor }}
          >
            {edge.label}
          </text>
        </g>
      )}
    </g>
  );
});

// ── Connection Line (while dragging) ─────────────────────────────────────────

function ConnectionLine({
  start,
  end,
}: {
  start: { x: number; y: number };
  end: { x: number; y: number };
}) {
  const deltaX = end.x - start.x;
  const cpOffset = deltaX > 0 
    ? Math.max(60, deltaX * 0.4) 
    : Math.max(30, Math.abs(deltaX) * 0.15);
  
  const path = `M ${start.x} ${start.y} C ${start.x + cpOffset} ${start.y}, ${end.x - cpOffset} ${end.y}, ${end.x} ${end.y}`;

  return (
    <path
      d={path}
      fill="none"
      stroke="#818cf8"
      strokeWidth={2}
      strokeDasharray="6 4"
      opacity={0.7}
    />
  );
}

// ── Main Canvas ──────────────────────────────────────────────────────────────

export default function WorkflowCanvas({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onDeleteNode,
  onMoveNode,
  onAddEdge,
  onDeleteEdge,
  nodeExecutionStatuses = {},
  nodeValidations = {},
  onAddNode,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const hasFitRef = useRef(false);

  // Dragging nodes
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const dragStart = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 });

  // Connection drawing
  const [connectionStart, setConnectionStart] = useState<{
    nodeId: string;
    port: string;
    x: number;
    y: number;
  } | null>(null);
  const [connectionEnd, setConnectionEnd] = useState({ x: 0, y: 0 });

  // ── Node Dragging ──────────────────────────────────────────
  const handleNodeDragStart = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const node = nodes.find((n) => n.id === id);
      if (!node) return;

      setDragNodeId(id);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        nodeX: node.position.x,
        nodeY: node.position.y,
      };
    },
    [nodes]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragNodeId) {
        const dx = (e.clientX - dragStart.current.x) / zoom;
        const dy = (e.clientY - dragStart.current.y) / zoom;
        onMoveNode(dragNodeId, {
          x: dragStart.current.nodeX + dx,
          y: dragStart.current.nodeY + dy,
        });
      } else if (isPanning) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        setPanOffset({
          x: panStart.current.offsetX + dx,
          y: panStart.current.offsetY + dy,
        });
      } else if (connectionStart) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          setConnectionEnd({
            x: (e.clientX - rect.left - panOffset.x) / zoom,
            y: (e.clientY - rect.top - panOffset.y) / zoom,
          });
        }
      }
    },
    [dragNodeId, isPanning, connectionStart, zoom, panOffset, onMoveNode]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (dragNodeId) {
        setDragNodeId(null);
      }
      if (isPanning) {
        setIsPanning(false);
      }
      if (connectionStart) {
        // Check if we're over a node's input port (LEFT side for LR layout)
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const mouseX = (e.clientX - rect.left - panOffset.x) / zoom;
          const mouseY = (e.clientY - rect.top - panOffset.y) / zoom;

          // Find if mouse is over any node's input area (left side)
          const targetNode = nodes.find((n) => {
            if (n.id === connectionStart.nodeId) return false;
            if (n.category === "trigger") return false; // can't connect TO a trigger
            const nx = n.position.x;
            const ny = n.position.y;
            return (
              mouseX >= nx - 20 &&
              mouseX <= nx + NODE_WIDTH + 20 &&
              mouseY >= ny - 20 &&
              mouseY <= ny + NODE_HEIGHT + 20
            );
          });

          if (targetNode) {
            onAddEdge(
              connectionStart.nodeId,
              targetNode.id,
              connectionStart.port !== "output" ? connectionStart.port : undefined
            );
          }
        }
        setConnectionStart(null);
      }
    },
    [dragNodeId, isPanning, connectionStart, nodes, zoom, panOffset, onAddEdge]
  );

  // ── Canvas Drag and Drop ───────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!onAddNode) return;

      const data = e.dataTransfer.getData("application/workflow-node");
      if (!data) return;

      try {
        const metadata: NodeMetadata = JSON.parse(data);
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const x = (e.clientX - rect.left - panOffset.x) / zoom;
          const y = (e.clientY - rect.top - panOffset.y) / zoom;
          onAddNode(metadata, { x, y });
        }
      } catch (err) {
        console.error("Failed to parse dropped node metadata:", err);
      }
    },
    [onAddNode, panOffset, zoom]
  );

  // ── Canvas Panning ─────────────────────────────────────────
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only pan on middle-click or when clicking empty canvas
      const target = e.target as HTMLElement;
      if (
        e.button === 1 || 
        target === canvasRef.current || 
        target.classList.contains("canvas-bg") ||
        target.id === "transform-container"
      ) {
        setIsPanning(true);
        panStart.current = {
          x: e.clientX,
          y: e.clientY,
          offsetX: panOffset.x,
          offsetY: panOffset.y,
        };
        onSelectNode(null);
      }
    },
    [panOffset, onSelectNode]
  );

  // ── Canvas Zoom (Zoom to Mouse) ──────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      // Allow scrolling if Ctrl/Cmd is not pressed? Usually canvas always zooms on scroll.
      // We will prevent default to stop page scroll.
      e.preventDefault();
      e.stopPropagation();

      const rect = canvas.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      setZoom((prevZoom) => {
        // Use a slightly smoother delta
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        // Optional: you can scale delta based on prevZoom for more natural feeling
        const zoomDelta = prevZoom * delta * 2; 
        const newZoom = Math.min(2, Math.max(0.3, prevZoom + (Math.abs(zoomDelta) < 0.05 ? delta : zoomDelta)));
        
        if (newZoom !== prevZoom) {
          setPanOffset((prevPan) => ({
            x: cursorX - (cursorX - prevPan.x) * (newZoom / prevZoom),
            y: cursorY - (cursorY - prevPan.y) * (newZoom / prevZoom),
          }));
        }
        return newZoom;
      });
    };

    // Attach wheel event directly. It only fires when mouse is over the element anyway.
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  // ── Port Click (start connection) ──────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handlePortClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const portId = target.getAttribute("data-port-id");
      const portType = target.getAttribute("data-port-type");

      if (portId && portType && (portType.startsWith("output"))) {
        e.stopPropagation();
        const parts = portId.split("-");
        const port = parts[parts.length - 1]; // "output", "yes", "no"
        const nId = parts.slice(0, -1).join("-");

        const node = nodes.find((n) => n.id === nId);
        if (!node) return;

        const sourcePos = getSourcePortPosition(
          node,
          ["yes", "no", "loop", "done"].includes(port) ? port : undefined
        );

        setConnectionStart({
          nodeId: nId,
          port: port,
          x: sourcePos.x,
          y: sourcePos.y,
        });
        setConnectionEnd(sourcePos);
      }
    };

    canvas.addEventListener("mousedown", handlePortClick, true);
    return () => canvas.removeEventListener("mousedown", handlePortClick, true);
  }, [nodes]);

  // ── Fit View on load ────────────────────────────────────────────
  useEffect(() => {
    if (nodes.length === 0 || hasFitRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    hasFitRef.current = true;
    const canvasW = canvas.clientWidth;
    const canvasH = canvas.clientHeight;

    const minX = Math.min(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    const maxX = Math.max(...nodes.map((n) => n.position.x + NODE_WIDTH));
    const maxY = Math.max(...nodes.map((n) => n.position.y + NODE_HEIGHT));

    const contentW = maxX - minX;
    const contentH = maxY - minY;

    const padding = 80;
    const scaleX = (canvasW - padding * 2) / contentW;
    const scaleY = (canvasH - padding * 2) / contentH;
    const newZoom = Math.min(1, Math.min(scaleX, scaleY)); // never zoom in beyond 100%

    const offsetX = (canvasW - contentW * newZoom) / 2 - minX * newZoom;
    const offsetY = padding - minY * newZoom;

    setZoom(newZoom);
    setPanOffset({ x: offsetX, y: offsetY });
  }, [nodes]);

  // Calculate SVG canvas bounds
  const maxX = Math.max(3200, ...nodes.map((n) => n.position.x + NODE_WIDTH + 600));
  const maxY = Math.max(2400, ...nodes.map((n) => n.position.y + NODE_HEIGHT + 600));

  return (
    <div
      ref={canvasRef}
      className="flex-1 h-full overflow-hidden relative cursor-grab active:cursor-grabbing bg-gray-50/50 dark:bg-transparent"
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDragEnter={(e) => e.preventDefault()}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Dot grid background */}
      <div
        className="canvas-bg absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle, rgba(99, 102, 241, 0.08) 1px, transparent 1px)`,
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${panOffset.x}px ${panOffset.y}px`,
        }}
      />
      {/* Subtle gradient mesh behind canvas */}
      <div className="absolute inset-0 pointer-events-none opacity-30 dark:opacity-15">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-violet-500/10 rounded-full blur-3xl" />
      </div>

      {/* Zoom indicator */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 bg-white/80 dark:bg-[#161b22]/80 backdrop-blur-xl rounded-xl border border-gray-200/50 dark:border-white/8 p-1 shadow-lg shadow-black/5 dark:shadow-black/20">
        <button
          onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
          className="w-8 h-8 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white flex items-center justify-center text-sm font-medium transition-all duration-150"
        >
          +
        </button>
        <div className="px-2 py-1 text-xs font-mono text-gray-500 dark:text-gray-400 min-w-[44px] text-center">
          {Math.round(zoom * 100)}%
        </div>
        <button
          onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
          className="w-8 h-8 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white flex items-center justify-center text-sm font-medium transition-all duration-150"
        >
          −
        </button>
        <div className="w-px h-5 bg-gray-200/50 dark:bg-white/8" />
        <button
          onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }}
          className="px-2.5 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-all duration-150 font-medium"
        >
          Reset
        </button>
      </div>

      {/* Transform container */}
      <div
        id="transform-container"
        style={{
          transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoom})`,
          transformOrigin: "0 0",
          position: "absolute",
          top: 0,
          left: 0,
          width: maxX,
          height: maxY,
        }}
      >
        {/* SVG Edges Layer */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={maxX}
          height={maxY}
          style={{ overflow: "visible" }}
        >
          <defs>
            <linearGradient id="edgeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#818cf8" stopOpacity="0.2" />
            </linearGradient>
          </defs>
          <g style={{ pointerEvents: "all" }}>
            {edges.map((edge) => (
              <EdgePath
                key={edge.id}
                edge={edge}
                sourceNode={nodes.find((n) => n.id === edge.sourceId)}
                targetNode={nodes.find((n) => n.id === edge.targetId)}
                onDelete={onDeleteEdge}
              />
            ))}
            {connectionStart && (
              <ConnectionLine
                start={{ x: connectionStart.x, y: connectionStart.y }}
                end={connectionEnd}
              />
            )}
          </g>
        </svg>

        {/* Nodes Layer */}
        {nodes.map((node) => (
          <WorkflowNodeCard
            key={node.id}
            node={node}
            isSelected={selectedNodeId === node.id}
            onSelect={onSelectNode}
            onDelete={onDeleteNode}
            onDragStart={handleNodeDragStart}
            executionState={nodeExecutionStatuses[node.id] || "idle"}
            validation={nodeValidations[node.id]}
          />
        ))}

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Start by adding a trigger from the palette
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Then add actions and conditions to build your workflow
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
