import React, { useState, useEffect } from 'react';

interface CRTLayerProps {
  sanity?: number; // 0-100
}

export const CRTLayer: React.FC<CRTLayerProps> = ({ sanity = 100 }) => {
  const [blackout, setBlackout] = useState(false);

  // Random blackout flashes when sanity is critical (<20)
  useEffect(() => {
    if (sanity >= 20) return;

    const interval = setInterval(() => {
      if (Math.random() < 0.3) { // 30% chance every tick
        setBlackout(true);
        setTimeout(() => setBlackout(false), 80 + Math.random() * 150);
      }
    }, 2000 + Math.random() * 3000);

    return () => clearInterval(interval);
  }, [sanity]);

  // Compute intensity tiers
  const isLow = sanity < 50;       // Mild effects
  const isCritical = sanity < 30;   // Strong effects
  const isDying = sanity < 15;      // Extreme effects

  // Dynamic values
  const scanlineOpacity = isLow ? (isCritical ? 0.5 : 0.35) : 0.2;
  const flickerOpacity = isLow ? (isCritical ? 0.15 : 0.08) : 0.05;

  // RGB shift amount scales with insanity
  const rgbShift = isDying ? 6 : isCritical ? 3 : isLow ? 1.5 : 0;

  // Screen shake
  const shakeClass = isDying
    ? 'sanity-shake-heavy'
    : isCritical
      ? 'sanity-shake-medium'
      : '';

  // Blood vignette intensity
  const vignetteOpacity = isDying ? 0.7 : isCritical ? 0.4 : isLow ? 0.15 : 0;

  return (
    <>
      {/* Base scanline */}
      <div
        className={`crt-scanline fixed inset-0 z-50 pointer-events-none mix-blend-overlay ${shakeClass}`}
        style={{ opacity: scanlineOpacity }}
      ></div>

      {/* Flicker */}
      <div
        className="crt-flicker fixed inset-0 z-50 pointer-events-none mix-blend-overlay"
        style={{ opacity: flickerOpacity }}
      ></div>

      {/* Vignette shadow */}
      <div className="fixed inset-0 pointer-events-none z-[51]" style={{
        boxShadow: "inset 0 0 100px rgba(0,0,0,0.9)"
      }}></div>

      {/* === SANITY EFFECTS === */}

      {/* RGB Chromatic Aberration - Red channel shifted */}
      {rgbShift > 0 && (
        <>
          <div
            className={`fixed inset-0 pointer-events-none z-[52] mix-blend-screen ${isDying ? 'sanity-rgb-drift' : ''}`}
            style={{
              background: 'transparent',
              boxShadow: `inset ${rgbShift}px 0 0 rgba(255, 0, 0, ${isDying ? 0.12 : 0.06}), inset -${rgbShift}px 0 0 rgba(0, 255, 255, ${isDying ? 0.1 : 0.04})`,
            }}
          ></div>
        </>
      )}

      {/* Blood/Red Vignette overlay */}
      {vignetteOpacity > 0 && (
        <div
          className={`fixed inset-0 pointer-events-none z-[52] ${isCritical ? 'sanity-vignette-pulse' : ''}`}
          style={{
            background: `radial-gradient(circle at center, transparent 30%, rgba(100, 0, 0, ${vignetteOpacity}) 100%)`,
          }}
        ></div>
      )}

      {/* Noise / Static grain overlay - intensifies with low sanity */}
      {isLow && (
        <div
          className="fixed inset-0 pointer-events-none z-[52] sanity-noise"
          style={{
            opacity: isDying ? 0.15 : isCritical ? 0.08 : 0.03,
            mixBlendMode: 'overlay',
          }}
        ></div>
      )}

      {/* Horizontal glitch bars */}
      {isCritical && (
        <div className="fixed inset-0 pointer-events-none z-[53] sanity-glitch-bars" style={{
          opacity: isDying ? 0.6 : 0.3,
        }}></div>
      )}

      {/* Full blackout flash */}
      {blackout && (
        <div className="fixed inset-0 bg-black z-[60] pointer-events-none"></div>
      )}

      {/* Screen shake wrapper - applies to the whole viewport via CSS on body */}
      {shakeClass && (
        <style>{`
          #root {
            animation: ${isDying ? 'screen-shake-heavy 0.1s infinite' : 'screen-shake 0.15s infinite'};
          }
        `}</style>
      )}
    </>
  );
};
