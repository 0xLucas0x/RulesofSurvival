import React from 'react';

export const CRTLayer: React.FC = () => {
  return (
    <>
      <div className="crt-scanline fixed inset-0 z-50 pointer-events-none opacity-20 mix-blend-overlay"></div>
      <div className="crt-flicker fixed inset-0 z-50 pointer-events-none opacity-5 mix-blend-overlay"></div>
      <div className="fixed inset-0 pointer-events-none z-[51]" style={{
        boxShadow: "inset 0 0 100px rgba(0,0,0,0.9)" 
      }}></div>
    </>
  );
};
