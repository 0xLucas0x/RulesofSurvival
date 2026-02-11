import React from 'react';

interface RuleBookProps {
  rules: string[];
}

export const RuleBook: React.FC<RuleBookProps> = ({ rules }) => {
  return (
    <aside className="hidden lg:flex w-80 bg-[#dcdcdc] border-r-8 border-metal-dark flex-col shrink-0 relative shadow-2xl overflow-hidden" 
           style={{ backgroundImage: "url('https://www.transparenttextures.com/patterns/notebook.png')" }}>
      
      {/* Clipboard Clip Visual */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-12 bg-gray-300 rounded-b-lg shadow-md z-20 flex items-center justify-center border-b-4 border-gray-400">
        <div className="w-24 h-8 border-2 border-gray-400 rounded bg-gradient-to-b from-gray-100 to-gray-300"></div>
      </div>

      <div className="pt-16 pb-4 px-6 border-b-2 border-dashed border-gray-400/50 relative">
        <div className="absolute top-20 right-6 transform rotate-12 opacity-80 border-4 border-red-800 text-red-800 font-header text-sm px-2 py-1 rounded animate-pulse">
          绝密 | 档案
        </div>
        <h2 className="text-2xl font-header font-bold text-black uppercase text-center tracking-tighter underline decoration-2 decoration-red-900/40">
          患者守则
        </h2>
        <p className="text-center font-hand text-blue-900 mt-1 text-xl -rotate-1">松田医生 批注</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar pb-20">
        <div className="space-y-6 relative">
          {rules.map((rule, index) => (
            <div key={index} className="flex gap-3 items-start group">
              <span className="font-header text-red-900 font-bold text-lg mt-0.5 select-none">{index + 1}.</span>
              <p className={`text-xl leading-6 font-hand transition-colors ${index % 2 === 0 ? 'text-blue-900' : 'text-black'} group-hover:text-red-800`}>
                {rule}
              </p>
            </div>
          ))}
        </div>
        
        {/* Decorative blood stain */}
        <div className="absolute bottom-10 right-4 w-16 h-16 bg-red-900/20 rounded-full blur-xl pointer-events-none mix-blend-multiply"></div>
      </div>
    </aside>
  );
};