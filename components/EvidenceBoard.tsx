import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../lib/i18n';
import { Evidence } from '../types';
import { Polaroid, StickyNote, ConfidentialDoc, KeyItem } from './EvidenceItems';

interface EvidenceBoardProps {
  // ... existing props
  isOpen: boolean;
  onClose: () => void;
  inventory: Evidence[];
  turnCount: number;
}

interface Position {
  x: number;
  y: number;
  rotation: number;
  zIndex: number;
}

// ------------------------------------------------------------------
// Main Board Component
// ------------------------------------------------------------------
export const EvidenceBoard: React.FC<EvidenceBoardProps> = ({ isOpen, onClose, inventory, turnCount }) => {
  const { t } = useTranslation();
  const [positions, setPositions] = useState<{ [id: string]: Position }>({});
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const boardRef = useRef<HTMLDivElement>(null);
  const maxZIndex = useRef(10);
  const [clockText, setClockText] = useState('');

  useEffect(() => {
    const tick = () => {
      // Use standard locale string or custom format. Here sticking to 24h format but localized digits/separators if applicable.
      setClockText(new Date().toLocaleTimeString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { hour12: false }));
    };
    const timer = setInterval(tick, 1000);
    tick();
    return () => clearInterval(timer);
  }, [i18n.language]); // Re-run if language changes


  // Load positions from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('evidence_board_positions');
    if (saved) {
      try {
        setPositions(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse evidence positions", e);
      }
    }
  }, []);

  // Initialize new items with random positions if not present
  useEffect(() => {
    if (inventory.length === 0) return;

    setPositions(prev => {
      const next = { ...prev };
      let hasChanges = false;
      const boardWidth = boardRef.current ? boardRef.current.clientWidth : window.innerWidth * 0.8;
      const boardHeight = boardRef.current ? boardRef.current.clientHeight : window.innerHeight * 0.8;

      inventory.forEach(item => {
        if (!next[item.id]) {
          hasChanges = true;
          // Random scatter
          next[item.id] = {
            x: Math.random() * (boardWidth - 200) + 50,
            y: Math.random() * (boardHeight - 200) + 50,
            rotation: (Math.random() - 0.5) * 20, // -10 to 10 degrees
            zIndex: maxZIndex.current++
          };
        }
      });

      if (hasChanges) {
        localStorage.setItem('evidence_board_positions', JSON.stringify(next));
        return next;
      }
      return prev;
    });
  }, [inventory, isOpen]);

  // Drag Handlers
  const handleMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault(); // Prevent text selection etc.

    // Bring to front
    maxZIndex.current += 1;
    setPositions(prev => ({
      ...prev,
      [id]: { ...prev[id], zIndex: maxZIndex.current }
    }));

    setIsDragging(id);

    // Calculate offset from item top-left to mouse
    // We need the item's current visual position relative to the board
    // However, since we position absolute based on `positions` state, we can just use that.
    // Mouse coords relative to board:
    if (!boardRef.current) return;
    const boardRect = boardRef.current.getBoundingClientRect();
    const mouseX = e.clientX - boardRect.left;
    const mouseY = e.clientY - boardRect.top;

    const currentPos = positions[id];
    dragOffset.current = {
      x: mouseX - currentPos.x,
      y: mouseY - currentPos.y
    };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !boardRef.current) return;

    const boardRect = boardRef.current.getBoundingClientRect();
    const mouseX = e.clientX - boardRect.left;
    const mouseY = e.clientY - boardRect.top;

    const newX = mouseX - dragOffset.current.x;
    const newY = mouseY - dragOffset.current.y;

    setPositions(prev => ({
      ...prev,
      [isDragging]: { ...prev[isDragging], x: newX, y: newY }
    }));
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(null);
      // Save on drop
      localStorage.setItem('evidence_board_positions', JSON.stringify(positions));
    }
  };

  // Attach global mouse listeners for drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, positions]); // depend on positions to save correctly in closure if needed, though state updater handles it

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 overflow-hidden">
      {/* Back drop */}
      <div
        className="absolute inset-0 bg-black/95 backdrop-blur-sm"
        onClick={onClose}
      ></div>

      {/* Main Board Area - Digital Terminal Style */}
      <div
        className="relative w-full h-full md:h-[90vh] bg-black border border-red-900/30 flex flex-col shadow-[0_0_50px_rgba(220,38,38,0.1)] overflow-hidden"
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking board background
      >
        {/* CRT/Grid Effects */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06)_1px,transparent_1px),linear-gradient(rgba(255,0,0,0.06)_1px,transparent_1px)] bg-[length:100%_4px,20px_20px,20px_20px] pointer-events-none"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.8)_100%)] pointer-events-none"></div>

        {/* Header - System Bar */}
        <div className="absolute top-0 left-0 right-0 h-10 bg-red-950/20 border-b border-red-900/30 flex items-center justify-between px-4 z-50 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-red-500 text-sm">database</span>
            <span className="font-tech text-red-500 text-xs tracking-widest uppercase">
              {t('evidence.survival_record', 'Survival Record')} // #{turnCount}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-[10px] text-red-900/60 uppercase hidden md:inline">
              {t('landing.system_time')}: {clockText} // Encryption: AES-256
            </span>
            <button
              onClick={onClose}
              className="hover:bg-red-900/30 text-red-500 hover:text-red-400 px-2 py-0.5 rounded text-xs font-tech tracking-widest border border-transparent hover:border-red-500/50 transition-all"
            >
              {t('evidence.close_terminal')}
            </button>
          </div>
        </div>

        {/* Board Content Area */}
        <div ref={boardRef} className="w-full h-full relative cursor-grab active:cursor-grabbing">
          {inventory.map((item) => {
            const pos = positions[item.id] || { x: 100, y: 100, rotation: 0, zIndex: 1 };

            // Render specific component based on type
            let Component = StickyNote; // Default
            if (item.type === 'photo') Component = Polaroid;
            if (item.type === 'document') Component = ConfidentialDoc;
            if (item.type === 'key') Component = KeyItem;

            return (
              <div
                key={item.id}
                onMouseDown={(e) => handleMouseDown(e, item.id)}
                style={{
                  position: 'absolute',
                  left: pos.x,
                  top: pos.y,
                  transform: `rotate(${pos.rotation}deg)`,
                  zIndex: pos.zIndex,
                  cursor: isDragging === item.id ? 'grabbing' : 'grab'
                }}
                className="select-none transition-shadow hover:z-[9999!important]" // hover z-index hack might flicker, handled by state instead
              >
                {/* Visual Component */}
                <Component item={item} />
              </div>
            );
          })}

          {inventory.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="font-tech text-xl text-red-900/40 select-none tracking-widest animate-pulse">
                {t('evidence.empty')}
              </p>
            </div>
          )}
        </div>

        {/* Footer info - Status Line */}
        <div className="absolute bottom-0 w-full bg-black/90 text-right py-1 px-4 border-t border-red-900/30 pointer-events-none z-50">
          <p className="font-mono text-[10px] text-red-700/50 tracking-[0.2em]">
            {t('evidence.status_line', { count: inventory.length, defaultValue: `Status: Exploring // Evidence: ${inventory.length}/12` })}
          </p>
        </div>
      </div>
    </div>
  );
};
