import React from 'react';

interface HeaderProps {
  sanity: number;
  location: string;
}

export const Header: React.FC<HeaderProps> = ({ sanity, location }) => {
  let sanityColor = "bg-green-500";
  let sanityText = "稳定";
  
  if (sanity < 70) {
    sanityColor = "bg-yellow-500";
    sanityText = "波动";
  }
  if (sanity < 30) {
    sanityColor = "bg-red-600";
    sanityText = "危急";
  }

  return (
    <header className="h-16 bg-metal-dark border-b-4 border-rust flex items-center justify-between px-6 z-30 relative shadow-lg shrink-0">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 bg-hospital-white rounded-full flex items-center justify-center border-2 border-rust text-blood-fresh">
          <span className="material-symbols-outlined text-xl font-bold">local_hospital</span>
        </div>
        <span className="font-header text-hospital-white tracking-widest text-lg md:text-xl shadow-black drop-shadow-md truncate">
          崇山医院_系统.v0.9
        </span>
      </div>
      
      <div className="flex items-center space-x-4 md:space-x-6 text-hospital-white/70 font-header text-xs tracking-widest">
        <span className="hidden md:flex items-center gap-2 px-3 py-1 bg-black/30 border border-white/10 rounded">
          <span className={`w-2 h-2 rounded-full ${sanityColor} animate-pulse shadow-[0_0_8px_currentColor]`}></span> 
          理智值: {sanity}% [{sanityText}]
        </span>
        <span className="uppercase text-rust-light font-bold truncate max-w-[150px]">{location}</span>
      </div>
    </header>
  );
};