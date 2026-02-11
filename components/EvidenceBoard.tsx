import React from 'react';
import { Evidence } from '../types';

interface EvidenceBoardProps {
  isOpen: boolean;
  onClose: () => void;
  inventory: Evidence[];
}

const getItemIcon = (type: string) => {
  switch (type) {
    case 'document': return 'description';
    case 'photo': return 'image';
    case 'key': return 'vpn_key';
    case 'item': return 'extension';
    default: return 'help_center';
  }
};

const getItemColor = (type: string) => {
  switch (type) {
    case 'document': return 'border-yellow-700/50 bg-yellow-900/10 text-yellow-500';
    case 'photo': return 'border-blue-700/50 bg-blue-900/10 text-blue-400';
    case 'key': return 'border-red-700/50 bg-red-900/10 text-red-400';
    default: return 'border-gray-600 bg-gray-800/20 text-gray-400';
  }
};

export const EvidenceBoard: React.FC<EvidenceBoardProps> = ({ isOpen, onClose, inventory }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop with blur and darken */}
      <div 
        className="absolute inset-0 bg-black/90 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      ></div>

      {/* Main Board Container */}
      <div className="relative w-full max-w-5xl h-[80vh] bg-[#1a1a1a] border-4 border-metal-dark shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden animate-[pulse-fast_0.2s_ease-out_1]">
        
        {/* CRT Scanline overlay for the modal specifically */}
        <div className="absolute inset-0 pointer-events-none opacity-10 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]"></div>

        {/* Header */}
        <div className="h-16 bg-metal-dark border-b-2 border-rust flex items-center justify-between px-6 shrink-0 relative z-10">
          <div className="flex items-center gap-3">
             <span className="material-symbols-outlined text-rust-light text-3xl">folder_shared</span>
             <h2 className="font-header text-2xl text-hospital-white tracking-[0.2em] uppercase shadow-black drop-shadow-md">
               物证管理 // EVIDENCE_BOARD
             </h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-red-900/50 rounded transition-colors text-hospital-white border border-transparent hover:border-red-500 group"
          >
            <span className="material-symbols-outlined group-hover:rotate-90 transition-transform">close</span>
          </button>
        </div>

        {/* Grid Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar bg-[#121212] relative">
          
          {/* Background decoration: "Confidential" stamp */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-5 rotate-[-15deg] select-none">
             <span className="font-header text-[15rem] text-red-600 border-8 border-red-600 px-10 rounded-xl">绝密</span>
          </div>

          {inventory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-600 font-header">
              <span className="material-symbols-outlined text-6xl mb-4 opacity-50">folder_off</span>
              <p className="text-xl tracking-widest">暂无证据收录</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {inventory.map((item) => (
                <div 
                  key={item.id}
                  className={`
                    relative group flex flex-col p-4 border-2 ${getItemColor(item.type)}
                    bg-black/40 backdrop-blur-md transition-all duration-300
                    hover:scale-[1.02] hover:bg-black/60 hover:shadow-[0_0_15px_rgba(0,0,0,0.5)]
                  `}
                >
                  {/* Pin Graphic */}
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-red-800 shadow-sm border border-black z-20"></div>

                  <div className="flex items-start gap-4 mb-3 pb-3 border-b border-white/10">
                    <div className="p-3 bg-white/5 rounded border border-white/10">
                      <span className="material-symbols-outlined text-3xl opacity-80">{getItemIcon(item.type)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                       <span className="text-[10px] uppercase font-mono tracking-widest opacity-50 block mb-1">
                         证据编号 #{item.id.slice(0,4)}
                       </span>
                       <h3 className="font-header text-lg md:text-xl font-bold truncate leading-tight">
                         {item.name}
                       </h3>
                    </div>
                  </div>
                  
                  <div className="flex-1 font-body text-gray-300 text-sm leading-relaxed text-justify opacity-90">
                    {item.description}
                  </div>

                  {/* Corner Decoration */}
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-white/20 rounded-br-lg opacity-50 group-hover:opacity-100 transition-opacity"></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
