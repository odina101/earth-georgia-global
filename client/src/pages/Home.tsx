/**
 * Home Page - Full screen 3D Globe visualization
 * Design: Globe centered, responsive for mobile and desktop
 * Theme: Dark brown background with white dots
 */

import Globe from '@/components/Globe';

export default function Home() {
  return (
    <div 
      className="h-[100dvh] w-full overflow-hidden fixed inset-0"
      style={{ 
        touchAction: 'none',
        background: 'linear-gradient(to bottom, #2d1f1a, #1a110d)'
      }}
    >
      {/* Full screen Globe Container - centered both horizontally and vertically */}
      <div className="w-full h-full flex items-center justify-center">
        {/* Globe wrapper - use smaller of width/height to ensure it fits */}
        <div 
          className="flex items-center justify-center"
          style={{ 
            width: 'min(85vw, 85dvh)', 
            height: 'min(85vw, 85dvh)',
          }}
        >
          <Globe />
        </div>
      </div>
    </div>
  );
}
