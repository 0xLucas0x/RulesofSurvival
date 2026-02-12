import React from 'react';
import { Evidence } from '../types';

interface ItemProps {
    item: Evidence;
    className?: string;
}

// ------------------------------------------------------------------
// 1. Polaroid Photo (for 'photo')
// ------------------------------------------------------------------
export const Polaroid: React.FC<ItemProps> = ({ item, className = '' }) => {
    return (
        <div className={`relative bg-[#f0f0f0] p-3 shadow-lg w-48 rotate-1 transition-transform hover:scale-105 ${className}`}>
            {/* Tape */}
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-12 bg-red-500/20 rotate-[-5deg] z-20 backdrop-blur-[1px] shadow-sm border-l border-r border-white/10"></div>

            {/* Image Area */}
            <div className="bg-black w-full h-40 mb-3 overflow-hidden flex items-center justify-center relative group">
                <div className="absolute inset-0 bg-neutral-800 opacity-20 group-hover:opacity-10 transition-opacity"></div>
                <span className="material-symbols-outlined text-5xl text-neutral-400">photo_camera</span>
                {/* Scanline overlay for photo feel */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%] pointer-events-none"></div>
            </div>

            {/* Caption Area */}
            <div className="px-1">
                <h4 className="font-hand text-xl text-neutral-800 leading-tight text-center transform -rotate-1">
                    {item.name}
                </h4>
                <p className="font-hand text-xs text-neutral-500 text-center mt-1">
                    {item.description.slice(0, 30)}...
                </p>
            </div>
        </div>
    );
};

// ------------------------------------------------------------------
// 2. Sticky Note (for 'item' and general notes)
// ------------------------------------------------------------------
export const StickyNote: React.FC<ItemProps> = ({ item, className = '' }) => {
    // Randomize color slightly based on ID logic or just default yellow for now
    // We can add variations later
    const colors = [
        'bg-yellow-200 text-yellow-900',
        'bg-blue-200 text-blue-900',
        'bg-pink-200 text-pink-900',
        'bg-green-200 text-green-900'
    ];
    // Simple hash for color stability
    const colorIdx = item.id.charCodeAt(item.id.length - 1) % colors.length;
    const colorClass = colors[colorIdx];

    return (
        <div className={`relative ${colorClass} w-40 h-40 p-4 shadow-md transition-transform hover:scale-105 flex flex-col ${className}`}>
            {/* Pin/Tape */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <div className="w-3 h-3 rounded-full bg-red-600 shadow-sm border border-red-800"></div>
            </div>

            <h4 className="font-hand text-2xl font-bold mb-2 leading-none border-b border-black/10 pb-2">
                {item.name}
            </h4>
            <p className="font-hand text-sm leading-tight flex-1 overflow-hidden">
                {item.description}
            </p>

            <div className="absolute bottom-1 right-1 opacity-20 transform rotate-[-5deg] font-mono text-[10px]">
                线索: {item.id.slice(0, 4)}
            </div>
        </div>
    );
};

// ------------------------------------------------------------------
// 3. Confidential Document (for 'document')
// ------------------------------------------------------------------
export const ConfidentialDoc: React.FC<ItemProps> = ({ item, className = '' }) => {
    return (
        <div className={`relative bg-[#f4f1ea] w-56 p-4 shadow-xl transition-transform hover:scale-105 ${className}`}>
            {/* Paper texture feel */}
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cream-paper.png')] pointer-events-none"></div>

            {/* Header */}
            <div className="flex justify-between items-end border-b-2 border-black/80 mb-3 pb-1">
                <span className="font-header text-xs tracking-widest text-neutral-500">机密</span>
                <span className="font-mono text-xs text-red-700 font-bold border border-red-700 px-1 rounded rotate-[10deg]">
                    绝密
                </span>
            </div>

            <h3 className="font-header text-lg font-bold text-black mb-2 uppercase tracking-wide">
                {item.name}
            </h3>

            <div className="font-body text-xs text-justify leading-relaxed text-neutral-800 relative">
                {item.description}
                {/* Redaction block example visually */}
                <span className="bg-black text-black select-none ml-1">已涂抹</span>
            </div>

            {/* Stamp */}
            <div className="absolute bottom-2 right-2 opacity-30 rotate-[-20deg] border-4 border-red-800 text-red-800 font-header font-bold text-2xl px-2 py-1 pointer-events-none">
                内部资料
            </div>
        </div>
    );
};

// ------------------------------------------------------------------
// 4. Key/Tag (for 'key')
// ------------------------------------------------------------------
export const KeyItem: React.FC<ItemProps> = ({ item, className = '' }) => {
    return (
        <div className={`relative bg-neutral-800 w-48 h-80 p-4 rounded-lg shadow-2xl border-2 border-neutral-600 flex flex-col items-center gap-4 ${className}`}>
            <div className="w-5 h-5 rounded-full bg-neutral-900 border border-neutral-700 shadow-inner mb-2"></div>

            <div className="w-full aspect-square bg-neutral-700 rounded flex items-center justify-center border border-neutral-600 shadow-inner group">
                <span className="material-symbols-outlined text-6xl text-yellow-600 drop-shadow-md group-hover:text-yellow-500 transition-colors">
                    vpn_key
                </span>
            </div>

            <div className="bg-white/10 w-full p-2 rounded text-center mt-auto">
                <h4 className="font-header text-sm text-neutral-300 tracking-wider uppercase truncate">
                    {item.name}
                </h4>
                <div className="h-[1px] w-full bg-white/10 my-1"></div>
                <p className="font-mono text-[9px] text-neutral-500 uppercase overflow-hidden text-ellipsis whitespace-nowrap">
                    {item.id}
                </p>
            </div>
        </div>
    );
};
