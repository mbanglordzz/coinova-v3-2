import React from 'react';
import { EWalletMethod } from '../types/dragon';

export interface IconProps {
  className?: string;
  size?: number;
}

/**
 * 1. COINOVA COIN ICON (Consolidated Official COINOVA Coin Icon)
 */
export const DragonCoinIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`inline-block shrink-0 select-none ${className}`}
  >
    <defs>
      <linearGradient id="novaCoinGradUnified" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FEF08A" />
        <stop offset="45%" stopColor="#FFEA00" />
        <stop offset="100%" stopColor="#EAB308" />
      </linearGradient>
    </defs>
    <circle
      cx="16"
      cy="16"
      r="14"
      fill="#0C0C10"
      stroke="url(#novaCoinGradUnified)"
      strokeWidth="2.4"
    />
    <circle
      cx="16"
      cy="16"
      r="10.5"
      fill="url(#novaCoinGradUnified)"
      fillOpacity="0.18"
      stroke="#FDE047"
      strokeOpacity="0.65"
      strokeWidth="1.2"
    />
    <path
      d="M19.2 12.2C18.3 11.4 17.1 11 15.7 11C12.8 11 10.6 13.2 10.6 16C10.6 18.8 12.8 21 15.7 21C17.1 21 18.3 20.6 19.2 19.8"
      stroke="#FDE047"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <circle cx="19.5" cy="16" r="1.8" fill="#FFEA00" />
  </svg>
);

/**
 * 2. OFFICIAL COINOVA DIAMOND ICON (Consolidated across entire application)
 */
export const DiamondIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`inline-block shrink-0 select-none ${className}`}
  >
    <defs>
      <linearGradient id="novaDiamondGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#67E8F9" />
        <stop offset="55%" stopColor="#22D3EE" />
        <stop offset="100%" stopColor="#38BDF8" />
      </linearGradient>
    </defs>
    <polygon
      points="16,3 28,12 16,29 4,12"
      fill="url(#novaDiamondGrad)"
      fillOpacity="0.22"
      stroke="url(#novaDiamondGrad)"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
    <polygon
      points="16,6 23,12 16,24 9,12"
      fill="url(#novaDiamondGrad)"
      fillOpacity="0.75"
    />
    <path d="M4 12H28" stroke="#A5F3FC" strokeOpacity="0.7" strokeWidth="1.3" />
  </svg>
);

export const DragonFireIcon = DiamondIcon;

/**
 * 3. OFFICIAL COINOVA LOGO EMBLEM (Consolidated Single Brand Logo across Login User, Register, Login Admin, Header, Profile)
 */
export const CyberDragonEmblemIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`inline-block shrink-0 select-none ${className}`}
  >
    <defs>
      <linearGradient id="coinovaLogoGradUnified" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FEF08A" />
        <stop offset="50%" stopColor="#FFEA00" />
        <stop offset="100%" stopColor="#FACC15" />
      </linearGradient>
    </defs>
    <polygon
      points="20,2 36,11 36,29 20,38 4,29 4,11"
      fill="#0A0A0D"
      stroke="url(#coinovaLogoGradUnified)"
      strokeWidth="2.4"
    />
    <polygon
      points="20,7 31,13.5 31,26.5 20,33 9,26.5 9,13.5"
      fill="#16140A"
      stroke="#FFEA00"
      strokeOpacity="0.4"
      strokeWidth="1.2"
    />
    <path
      d="M24.5 14.5C23.2 13.3 21.5 12.6 19.5 12.6C15.4 12.6 12.2 15.8 12.2 20C12.2 24.2 15.4 27.4 19.5 27.4C21.5 27.4 23.2 26.7 24.5 25.5"
      stroke="url(#coinovaLogoGradUnified)"
      strokeWidth="3.2"
      strokeLinecap="round"
    />
    <circle cx="24.5" cy="20" r="2.6" fill="#FFEA00" />
  </svg>
);

/**
 * 3B. NEON DRAGON CENTERPIECE SVG (Simple, Clean, Futuristic Neon Dragon Symbol for Main Arena)
 */
export const NeonDragonCenterpieceSvg: React.FC<{
  level?: number;
  isAttacking?: boolean;
  className?: string;
}> = ({ level = 1, isAttacking = false, className = 'h-32 w-32' }) => (
  <svg
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`inline-block shrink-0 select-none ${className}`}
  >
    <defs>
      <linearGradient id="dragonOuterNeon" x1="12" y1="10" x2="108" y2="110" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" />
        <stop offset="50%" stopColor="#818CF8" />
        <stop offset="100%" stopColor="#C084FC" />
      </linearGradient>
      <linearGradient id="dragonCoreFill" x1="25" y1="20" x2="95" y2="100" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#130E2E" />
        <stop offset="100%" stopColor="#070514" />
      </linearGradient>
    </defs>

    {/* Outer Futuristic Octagonal Cyber Frame */}
    <polygon
      points="38,8 82,8 112,38 112,82 82,112 38,112 8,82 8,38"
      fill="url(#dragonCoreFill)"
      stroke="url(#dragonOuterNeon)"
      strokeWidth={isAttacking ? '2.8' : '2'}
      strokeLinejoin="round"
    />

    {/* Subtle Inner Tech Ring */}
    <circle
      cx="60"
      cy="60"
      r="42"
      stroke="#38BDF8"
      strokeOpacity={isAttacking ? '0.55' : '0.24'}
      strokeWidth="1.2"
      strokeDasharray="6 4"
    />

    {/* Clean Geometric Futuristic Dragon Crest */}
    <path
      d="M28 34L46 48L60 24L74 48L92 34L84 68L60 94L36 68L28 34Z"
      fill="#0D0924"
      stroke="url(#dragonOuterNeon)"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    {/* Inner Dragon Horns & Crown Line-Art */}
    <path
      d="M46 48L60 38L74 48M36 68L60 56L84 68"
      stroke="#A855F7"
      strokeOpacity="0.65"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    {/* Glowing Neon Cyber Dragon Eyes */}
    <path
      d="M45 58L55 63M75 58L65 63"
      stroke={isAttacking ? '#F0ABFC' : '#38BDF8'}
      strokeWidth="3"
      strokeLinecap="round"
    />

    {/* Dragon Energy Core Gem at Snout/Center */}
    <polygon
      points="60,68 66,76 60,84 54,76"
      fill={isAttacking ? '#38BDF8' : '#A855F7'}
      fillOpacity="0.85"
      stroke="#E0F2FE"
      strokeWidth="1.2"
    />

    {/* Level Indicator Dots at Top */}
    {Array.from({ length: Math.min(5, Math.max(1, level)) }).map((_, idx, arr) => {
      const spacing = 8;
      const startX = 60 - ((arr.length - 1) * spacing) / 2;
      return (
        <circle
          key={idx}
          cx={startX + idx * spacing}
          cy="16"
          r="2.2"
          fill="#38BDF8"
        />
      );
    })}
  </svg>
);

/**
 * 4. NEON LEVEL DRAGON ICON (Clean Geometric Tier Emblem for Levels 1-5)
 */
export const NeonLevelDragonIcon: React.FC<{ level: number; className?: string }> = ({
  level,
  className = 'h-12 w-12',
}) => {
  const strokeA = level >= 4 ? '#38BDF8' : '#C084FC';
  const strokeB = level >= 4 ? '#A855F7' : '#38BDF8';

  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block shrink-0 select-none ${className}`}
    >
      <defs>
        <linearGradient id={`cleanLvl_${level}`} x1="4" y1="4" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={strokeA} />
          <stop offset="100%" stopColor={strokeB} />
        </linearGradient>
      </defs>
      <rect
        x="2.5"
        y="2.5"
        width="31"
        height="31"
        rx="9"
        fill="#080616"
        stroke={`url(#cleanLvl_${level})`}
        strokeWidth="1.6"
      />
      {/* Minimal Geometric Dragon Crest */}
      <path
        d="M9.5 12L14.8 15.5L18 9.5L21.2 15.5L26.5 12L24.2 20.5L18 26.5L11.8 20.5L9.5 12Z"
        stroke={`url(#cleanLvl_${level})`}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.2 18.5L16.5 19.8M21.8 18.5L19.5 19.8"
        stroke="#38BDF8"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {level >= 4 && (
        <path
          d="M15 7.5L18 5.5L21 7.5"
          stroke="#38BDF8"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
};

/**
 * 5. MISSION LINE-ART ICON (Simple Geometric Neon Mission Badges)
 */
export const MissionLineArtIcon: React.FC<{ taskId: string; className?: string }> = ({
  taskId,
  className = 'h-10 w-10',
}) => (
  <svg
    viewBox="0 0 36 36"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`inline-block shrink-0 select-none ${className}`}
  >
    <defs>
      <linearGradient id={`msnSimple_${taskId}`} x1="4" y1="4" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#38BDF8" />
        <stop offset="100%" stopColor="#A855F7" />
      </linearGradient>
    </defs>
    <rect
      x="2.5"
      y="2.5"
      width="31"
      height="31"
      rx="9"
      fill="#080616"
      stroke={`url(#msnSimple_${taskId})`}
      strokeWidth="1.6"
    />
    {taskId === 'vp_join_channel' ? (
      <path
        d="M10.5 18L25 11.5L22 25L17.2 20.2L10.5 18ZM17.2 20.2L25 11.5"
        stroke="#38BDF8"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : taskId === 'vp_level_bonus' ? (
      <path
        d="M18 9.5L25.5 14V21.5L18 26.5L10.5 21.5V14L18 9.5ZM14.5 19L18 15.5L21.5 19"
        stroke="#C084FC"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : taskId === 'vp_invite_5' ? (
      <>
        <circle cx="15.5" cy="15" r="3.2" stroke="#38BDF8" strokeWidth="1.7" />
        <path
          d="M10 24.5C10 21.7 12.4 19.8 15.5 19.8C18.6 19.8 21 21.7 21 24.5M24 14V20M21 17H27"
          stroke="#C084FC"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </>
    ) : (
      <path
        d="M19.5 9.5L12 19H18L16.5 26.5L24 17H18L19.5 9.5Z"
        stroke="#38BDF8"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )}
  </svg>
);

/**
 * 6. UNIFIED NAVIGATION & ACTION ICONS (1.75px Geometric Futuristic Line-Art)
 */
export const NavHomeIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 10.5L12 4L20 10.5V19A1.5 1.5 0 0 1 18.5 20.5H5.5A1.5 1.5 0 0 1 4 19V10.5Z" />
    <path d="M9.5 15.5H14.5" />
  </svg>
);

export const NavTaskIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="3" />
    <path d="M8.5 10L10.8 12.2L15.5 7.8" />
    <path d="M8.5 16H15.5" />
  </svg>
);

export const NavInviteIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="9.5" cy="8.5" r="3.2" />
    <path d="M4 19.5C4 16.5 6.5 14.2 9.5 14.2C12.5 14.2 15 16.5 15 19.5" />
    <path d="M18.5 8.5V14.5M15.5 11.5H21.5" />
  </svg>
);

export const NavWithdrawIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
    <path d="M3 10H21" />
    <circle cx="16.5" cy="14.2" r="1.2" fill="currentColor" />
  </svg>
);

export const NavProfileIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5.5 19.5C5.5 16.2 8.4 14 12 14C15.6 14 18.5 16.2 18.5 19.5" />
  </svg>
);

export const ConvertIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M16 4L20 8L16 12" />
    <path d="M4 8H20" />
    <path d="M8 20L4 16L8 12" />
    <path d="M20 16H4" />
  </svg>
);

export const LevelBadgeIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 3L19 7V13C19 17.2 15.8 20.2 12 21.5C8.2 20.2 5 17.2 5 13V7L12 3Z" />
    <path d="M9 13L12 10L15 13" />
  </svg>
);

export const GiftIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3.5" y="8" width="17" height="4" rx="1.2" />
    <path d="M5.5 12V18.5A1.5 1.5 0 0 0 7 20H17A1.5 1.5 0 0 0 18.5 18.5V12" />
    <path d="M12 8V20" />
    <path d="M12 8C12 8 10 4.5 7.8 4.5C6.4 4.5 5.5 5.5 5.5 6.8C5.5 7.6 6.2 8 7.5 8H16.5C17.8 8 18.5 7.6 18.5 6.8C18.5 5.5 17.6 4.5 16.2 4.5C14 4.5 12 8 12 8Z" />
  </svg>
);

export const HistoryIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12L15 13.8" />
  </svg>
);

export const NotificationIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M17.5 16.5H6.5L8 14V10C8 7.5 9.8 5.5 12 5.5C14.2 5.5 16 7.5 16 10V14L17.5 16.5Z" />
    <path d="M10.2 19.5C10.6 20.2 11.2 20.5 12 20.5C12.8 20.5 13.4 20.2 13.8 19.5" />
  </svg>
);

export const SettingsIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 3.5L19 7.5V16.5L12 20.5L5 16.5V7.5L12 3.5Z" />
    <circle cx="12" cy="12" r="2.8" />
  </svg>
);

export const EnergyBoltIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M13 3L5 13.5H11.5L10.5 21L19 10.5H12.5L13 3Z" />
  </svg>
);

export const TapStrikeIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 3L14.5 9.5L21 12L14.5 14.5L12 21L9.5 14.5L3 12L9.5 9.5L12 3Z" />
  </svg>
);

export const ArrowBackIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M15 18L9 12L15 6" />
  </svg>
);

export const CloseIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M18 6L6 18M6 6L18 18" />
  </svg>
);

export const CheckNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M20 6L9 17L4 12" />
  </svg>
);

export const CheckCircleNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12.2L10.8 14.5L15.5 9.8" />
  </svg>
);

export const LockNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="5" y="11" width="14" height="9.5" rx="2.5" />
    <path d="M8 11V7.5C8 5.3 9.8 3.5 12 3.5C14.2 3.5 16 5.3 16 7.5V11" />
  </svg>
);

export const CopyNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4A1.5 1.5 0 0 1 2.5 13.5V4A1.5 1.5 0 0 1 4 2.5H13.5A1.5 1.5 0 0 1 15 4V5" />
  </svg>
);

export const ShareNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="18" cy="5.5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="18.5" r="2.5" />
    <path d="M8.3 10.8L15.7 6.7M8.3 13.2L15.7 17.3" />
  </svg>
);

export const UserPlusNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="9.5" cy="8.5" r="3.2" />
    <path d="M4 19.5C4 16.5 6.5 14.2 9.5 14.2C12.5 14.2 15 16.5 15 19.5" />
    <path d="M18.5 8.5V14.5M15.5 11.5H21.5" />
  </svg>
);

export const ShieldNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 3L19 6.5V12.5C19 16.8 16 19.8 12 21C8 19.8 5 16.8 5 12.5V6.5L12 3Z" />
    <path d="M9 12.2L11 14.2L15.2 10" />
  </svg>
);

export const ClockNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12L14.8 13.8" />
  </svg>
);

export const XCircleNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M14.8 9.2L9.2 14.8M9.2 9.2L14.8 14.8" />
  </svg>
);

export const AlertNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8V12.5M12 15.8H12.01" />
  </svg>
);

export const ChevronRightNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M9 6L15 12L9 18" />
  </svg>
);

export const LogoutNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V5.5A1.5 1.5 0 0 1 5.5 4H9" />
    <path d="M16 16.5L20.5 12L16 7.5" />
    <path d="M20.5 12H9.5" />
  </svg>
);

export const HelpNeonIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.8 9.5C10.2 8.2 11.8 7.8 13 8.3C14.2 8.8 14.6 10.2 13.6 11.2C12.8 12 12 12.4 12 13.5" />
    <path d="M12 16.8H12.01" />
  </svg>
);

export const PlusNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 5V19M5 12H19" />
  </svg>
);

export const ExternalLinkNeonIcon: React.FC<IconProps> = ({ className = 'h-3.5 w-3.5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14 4H20V10" />
    <path d="M10 14L20 4" />
    <path d="M20 14V18.5A1.5 1.5 0 0 1 18.5 20H5.5A1.5 1.5 0 0 1 4 18.5V5.5A1.5 1.5 0 0 1 5.5 4H10" />
  </svg>
);

export const ExportCsvNeonIcon: React.FC<IconProps> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
    <path d="M8 9H16M8 13H16M8 17H12" />
  </svg>
);

export const ReceiptNeonIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M5 4H19V20L16.5 18.2L14 20L12 18.2L10 20L7.5 18.2L5 20V4Z" />
    <path d="M8.5 9H15.5M8.5 13H13.5" />
  </svg>
);

/**
 * OFFICIAL E-WALLET BRAND LOGOS (DANA, GoPay, OVO, ShopeePay, QRIS)
 * Recognizable official brand colors & wordmarks/symbols wrapped in a clean container.
 */
export const EWalletBrandBadge: React.FC<{ method: EWalletMethod | 'QRIS'; className?: string }> = ({
  method,
  className = 'h-9 w-9',
}) => {
  if (method === 'QRIS') {
    return (
      <div
        className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white shadow-[0_0_12px_rgba(56,189,248,0.22)] ${className}`}
        title="QRIS Standar Pembayaran Nasional"
      >
        <svg viewBox="0 0 64 64" fill="none" className="h-4/5 w-4/5">
          <rect x="6" y="8" width="16" height="16" rx="2.5" stroke="#111827" strokeWidth="4" />
          <rect x="11" y="13" width="6" height="6" fill="#E11D48" />
          <rect x="42" y="8" width="16" height="16" rx="2.5" stroke="#111827" strokeWidth="4" />
          <rect x="47" y="13" width="6" height="6" fill="#111827" />
          <rect x="6" y="30" width="16" height="16" rx="2.5" stroke="#111827" strokeWidth="4" />
          <rect x="11" y="35" width="6" height="6" fill="#111827" />
          <path d="M30 10H36V22H30V10ZM30 28H58V34H30V28ZM42 38H58V44H42V38Z" fill="#E11D48" />
          <text
            x="32"
            y="59"
            textAnchor="middle"
            fill="#111827"
            fontSize="13.5"
            fontWeight="900"
            fontFamily="Arial, sans-serif"
            letterSpacing="1.2"
          >
            QRIS
          </text>
        </svg>
      </div>
    );
  }

  if (method === 'DANA') {
    return (
      <div
        className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-[#38bdf8]/40 bg-[#118EEA] shadow-[0_0_12px_rgba(17,142,234,0.4)] ${className}`}
        title="DANA"
      >
        <svg viewBox="0 0 64 64" fill="none" className="h-4/5 w-4/5">
          {/* Official DANA White Coin/Wave Emblem + Wordmark */}
          <circle cx="32" cy="22" r="11" fill="white" fillOpacity="0.2" />
          <path
            d="M17 21.5C21.5 18 27 25 32 21.5C37 18 42.5 25 47 21.5V27.5C42.5 31 37 24 32 27.5C27 31 21.5 24 17 27.5V21.5Z"
            fill="white"
          />
          <text
            x="32"
            y="51"
            textAnchor="middle"
            fill="white"
            fontSize="15"
            fontWeight="900"
            fontFamily="Arial, Helvetica, sans-serif"
            letterSpacing="1"
          >
            DANA
          </text>
        </svg>
      </div>
    );
  }

  if (method === 'GoPay') {
    return (
      <div
        className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-[#38bdf8]/40 bg-[#00AED6] shadow-[0_0_12px_rgba(0,174,214,0.4)] ${className}`}
        title="GoPay"
      >
        <svg viewBox="0 0 64 64" fill="none" className="h-4/5 w-4/5">
          {/* Official GoPay Wallet Icon + gopay Wordmark */}
          <rect
            x="14"
            y="10"
            width="36"
            height="24"
            rx="6"
            fill="white"
          />
          <rect
            x="33"
            y="17"
            width="17"
            height="10"
            rx="4"
            fill="#00AED6"
          />
          <circle cx="38" cy="22" r="2.2" fill="white" />
          <text
            x="32"
            y="51"
            textAnchor="middle"
            fill="white"
            fontSize="14.5"
            fontWeight="900"
            fontFamily="Arial, Helvetica, sans-serif"
            letterSpacing="0.4"
          >
            gopay
          </text>
        </svg>
      </div>
    );
  }

  if (method === 'OVO') {
    return (
      <div
        className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-[#FACC15]/45 bg-[#18181F] shadow-[0_0_12px_rgba(250,204,21,0.25)] ${className}`}
        title="OVO"
      >
        <svg viewBox="0 0 64 64" fill="none" className="h-4/5 w-4/5">
          {/* Official OVO Geometric Wordmark */}
          <circle cx="15" cy="32" r="8" stroke="white" strokeWidth="4.8" />
          <path
            d="M26 23L32 41L38 23"
            stroke="white"
            strokeWidth="4.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="49" cy="32" r="8" stroke="white" strokeWidth="4.8" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-orange-400/40 bg-[#EE4D2D] shadow-[0_0_12px_rgba(238,77,45,0.4)] ${className}`}
      title="ShopeePay"
    >
      <svg viewBox="0 0 64 64" fill="none" className="h-4/5 w-4/5">
        {/* Official ShopeePay Bag + S Symbol */}
        <path
          d="M23 20V17.5C23 12.8 27 9 32 9C37 9 41 12.8 41 17.5V20"
          stroke="white"
          strokeWidth="3.8"
          strokeLinecap="round"
        />
        <path
          d="M14 20H50L47.2 50.5C46.9 53.6 44.3 56 41.2 56H22.8C19.7 56 17.1 53.6 16.8 50.5L14 20Z"
          fill="white"
        />
        <path
          d="M36.8 29.5C35.8 28 33.9 27.2 31.8 27.2C28.8 27.2 26.8 28.8 26.8 31C26.8 33.4 29.2 34.2 32.6 35.2C36.3 36.2 38.4 37.6 38.4 40.6C38.4 43.8 35.6 46 31.6 46C28.5 46 26 44.8 24.8 42.8"
          stroke="#EE4D2D"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
};

export const UploadNeonIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M21 15V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V15" />
    <path d="M17 8L12 3L7 8" />
    <path d="M12 3V15" />
  </svg>
);

export const EyeNeonIcon: React.FC<IconProps> = ({ className = 'h-5 w-5' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M2 12C4.5 7 8 4.5 12 4.5C16 4.5 19.5 7 22 12C19.5 17 16 19.5 12 19.5C8 19.5 4.5 17 2 12Z" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
);

/**
 * OFFICIAL QRIS PAYMENT DISPLAY CARD FOR REAL-MONEY UPGRADE ORDERS
 * Dynamically displays the active QRIS configured by Admin from the server.
 * Never displays hardcoded or dummy QR codes.
 */
export const OfficialQRISCodeDisplay: React.FC<{
  orderId: string;
  amountIdr: number;
  merchantName: string;
  nmid: string;
  qrisImageUrl?: string | null;
  isLoadingQris?: boolean;
}> = ({ orderId, amountIdr, merchantName, qrisImageUrl, isLoadingQris }) => {
  const [fetchedImageUrl, setFetchedImageUrl] = React.useState<string | null>(
    null
  );
  const [internalLoading, setInternalLoading] = React.useState<boolean>(
    qrisImageUrl === undefined
  );

  React.useEffect(() => {
    if (qrisImageUrl !== undefined) {
      setInternalLoading(false);
      return;
    }
    let mounted = true;
    const loadQris = async () => {
      try {
        const res = await fetch(`/api/qris?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) {
          setFetchedImageUrl(
            data?.qris?.hasQris && data?.qris?.imageDataUrl
              ? String(data.qris.imageDataUrl)
              : null
          );
        }
      } catch {
        // ignore network error
      } finally {
        if (mounted) {
          setInternalLoading(false);
        }
      }
    };
    void loadQris();
    return () => {
      mounted = false;
    };
  }, [qrisImageUrl]);

  const activeImageUrl =
    qrisImageUrl !== undefined ? qrisImageUrl : fetchedImageUrl;
  const showLoading =
    isLoadingQris !== undefined ? isLoadingQris : internalLoading;

  return (
    <div className="mx-auto w-full max-w-[280px] rounded-2xl border border-[#FFEA00]/45 bg-[#0C0C10] p-3.5 text-white shadow-[0_0_24px_rgba(255,234,0,0.16)]">
      {/* QRIS Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-[#FFEA00] px-1.5 py-0.5 text-[10px] font-black tracking-wider text-[#08080A]">
            QRIS
          </span>
          <span className="text-[9.5px] font-bold uppercase text-zinc-300">
            Pembayaran Resmi
          </span>
        </div>
        <span className="truncate text-[9.5px] font-extrabold text-[#FACC15]">
          {merchantName}
        </span>
      </div>

      {/* Dynamic QRIS Image from Admin Settings or Unavailable Message */}
      <div className="my-3 flex items-center justify-center">
        {showLoading ? (
          <div className="flex h-44 w-full items-center justify-center rounded-xl border border-white/10 bg-[#08080B] px-3 py-6 text-center">
            <p className="text-xs font-bold text-zinc-400">
              Memuat QRIS pembayaran...
            </p>
          </div>
        ) : activeImageUrl ? (
          <div className="w-full overflow-hidden rounded-xl border border-[#FFEA00]/40 bg-white p-2">
            <img
              src={activeImageUrl}
              alt="QRIS Pembayaran Resmi COINOVA"
              className="mx-auto max-h-64 w-full rounded-lg object-contain"
            />
          </div>
        ) : (
          <div className="flex min-h-[140px] w-full flex-col items-center justify-center rounded-xl border border-[#FACC15]/30 bg-[#12110B] px-4 py-6 text-center">
            <p className="text-xs font-extrabold text-[#FFEA00]">
              QRIS pembayaran belum tersedia.
            </p>
          </div>
        )}
      </div>

      {/* Footer Nominal & Order ID */}
      <div className="rounded-xl border border-white/10 bg-[#08080B] px-3 py-2 text-center">
        <p className="font-mono-num text-xs font-black text-[#FFEA00]">
          Rp {amountIdr.toLocaleString('id-ID')}
        </p>
        {orderId && (
          <p className="font-mono-num mt-0.5 text-[9px] font-semibold text-zinc-400">
            Order: {orderId}
          </p>
        )}
      </div>
    </div>
  );
};
