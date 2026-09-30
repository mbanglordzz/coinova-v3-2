import React from 'react';

/**
 * ============================================================================
 * COINOVA — NEON FUTURISTIC FINTECH & GAMING VISUAL SYSTEM
 * THEME: DARK BLACK + NEON HIGHLIGHTER YELLOW (#FFEA00 / #FACC15 / #FDE047) + WHITE
 * ============================================================================
 */

/**
 * 1. COINOVA BRAND LOGO MARK
 */
export const CoinovaLogoMark: React.FC<{ className?: string }> = ({
  className = 'h-7 w-7',
}) => (
  <svg viewBox="0 0 40 40" fill="none" className={className}>
    <defs>
      <linearGradient id="coinovaLogoGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FEF08A" />
        <stop offset="50%" stopColor="#FFEA00" />
        <stop offset="100%" stopColor="#FACC15" />
      </linearGradient>
    </defs>
    <polygon
      points="20,2 36,11 36,29 20,38 4,29 4,11"
      fill="#0A0A0D"
      stroke="url(#coinovaLogoGrad)"
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
      stroke="url(#coinovaLogoGrad)"
      strokeWidth="3.2"
      strokeLinecap="round"
    />
    <circle cx="24.5" cy="20" r="2.6" fill="#FFEA00" />
  </svg>
);

/**
 * 2. NOVA COIN ICON (Primary Currency — Neon Highlighter Yellow)
 */
export const NovaCoinIcon: React.FC<{ className?: string }> = ({
  className = 'h-4 w-4',
}) => (
  <svg viewBox="0 0 32 32" fill="none" className={className}>
    <defs>
      <linearGradient id="novaCoinGrad" x1="0" y1="0" x2="1" y2="1">
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
      stroke="url(#novaCoinGrad)"
      strokeWidth="2.4"
    />
    <circle
      cx="16"
      cy="16"
      r="10.5"
      fill="url(#novaCoinGrad)"
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

export const GoldCoinItemIcon = NovaCoinIcon;

/**
 * 3. NOVA DIAMOND / CORE CRYSTAL ICON (Secondary Currency - fireBalance)
 * Retains Cyan/Blue Diamond identity with subtle yellow-white highlight
 */
export const NovaDiamondIcon: React.FC<{ className?: string }> = ({
  className = 'h-4 w-4',
}) => (
  <svg viewBox="0 0 32 32" fill="none" className={className}>
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

export const DiamondIcon = NovaDiamondIcon;

/**
 * 4. VERIFIED NEON BADGE (Highlighter Yellow)
 */
export const VerifiedBlueBadge: React.FC<{ className?: string }> = ({
  className = 'h-4 w-4',
}) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle
      cx="12"
      cy="12"
      r="10"
      fill="#16140A"
      stroke="#FFEA00"
      strokeWidth="2"
    />
    <path
      d="M8 12.3L10.7 15L16.2 9.5"
      stroke="#FEF08A"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 5. CYBER AVATAR SVG (Futuristic User Avatar — Dark Black + Neon Yellow)
 */
export const CoinovaAvatarSvg: React.FC<{ className?: string }> = ({
  className = 'h-12 w-12',
}) => (
  <svg viewBox="0 0 64 64" fill="none" className={className}>
    <defs>
      <linearGradient id="avatarRing" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FEF08A" />
        <stop offset="55%" stopColor="#FFEA00" />
        <stop offset="100%" stopColor="#EAB308" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="32" fill="#0A0A0E" />
    <circle
      cx="32"
      cy="32"
      r="29"
      stroke="url(#avatarRing)"
      strokeWidth="2.5"
    />
    {/* Cyber Visor Head */}
    <circle
      cx="32"
      cy="24"
      r="10"
      fill="#18160C"
      stroke="#FACC15"
      strokeWidth="2"
    />
    <rect
      x="24"
      y="21"
      width="16"
      height="5"
      rx="2.5"
      fill="#FFEA00"
    />
    {/* Futuristic Shoulders */}
    <path
      d="M14 52C16 42 23 38 32 38C41 38 48 42 50 52"
      fill="#18160C"
      stroke="#FDE047"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * 6. FUTURISTIC CYBER VAULT / CHEST MODULE
 */
export const TreasureChestBlock: React.FC<{
  className?: string;
  onClick?: () => void;
}> = ({ className = 'h-14 w-14', onClick }) => (
  <div
    onClick={onClick}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={
      onClick
        ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick();
            }
          }
        : undefined
    }
    className={`relative flex items-center justify-center rounded-2xl border border-[#FFEA00]/50 bg-gradient-to-b from-[#1E1B0D] to-[#0B0B0F] p-2 shadow-[0_0_20px_rgba(255,234,0,0.18)] ${
      onClick ? 'cursor-pointer active:scale-95 transition-transform' : ''
    } ${className}`}
  >
    <svg viewBox="0 0 64 64" fill="none" className="h-full w-full">
      <polygon
        points="32,6 54,18 54,46 32,58 10,46 10,18"
        fill="#12110A"
        stroke="#FACC15"
        strokeWidth="2.4"
      />
      <polygon
        points="32,14 46,22 46,42 32,50 18,42 18,22"
        fill="#1F1C0E"
        stroke="#FEF08A"
        strokeWidth="1.6"
      />
      <path d="M10 18L32 30L54 18" stroke="#FACC15" strokeWidth="2" />
      <path d="M32 30V58" stroke="#FACC15" strokeWidth="2" />
      <circle
        cx="32"
        cy="30"
        r="6"
        fill="#FFEA00"
        stroke="#08080A"
        strokeWidth="2"
      />
    </svg>
  </div>
);

export const GreenBrickBlock: React.FC<{ className?: string }> = ({
  className = 'h-12 w-12',
}) => (
  <div
    className={`flex items-center justify-center rounded-2xl border border-[#FACC15]/25 bg-[#12110B]/90 p-2 shadow-inner ${className}`}
  >
    <NovaCoinIcon className="h-6 w-6" />
  </div>
);

/**
 * 7. COINOVA CENTERPIECE "TAP KOIN" REACTOR BUTTON (Home Main Interactive Core)
 */
export const CoinovaTapCoreReactor: React.FC<{
  isBouncing?: boolean;
  perClickCoins?: number;
  className?: string;
}> = React.memo(({ isBouncing = false, perClickCoins = 300, className = 'h-[210px] w-[210px]' }) => (
  <div
    className={`relative flex items-center justify-center will-change-transform animate-core-idle ${className} ${
      isBouncing ? 'scale-95' : ''
    } transition-transform duration-75`}
  >
    {/* Ambient Neon Highlighter Yellow Radial Glow */}
    <div
      className="pointer-events-none absolute inset-2 rounded-full bg-[#FFEA00]/22 blur-2xl"
    />

    {/* Outer Rotating HUD Ring */}
    <svg
      viewBox="0 0 240 240"
      fill="none"
      className="pointer-events-none absolute inset-0 h-full w-full animate-spin-slow"
    >
      <circle
        cx="120"
        cy="120"
        r="112"
        stroke="#FACC15"
        strokeOpacity="0.32"
        strokeWidth="1.5"
        strokeDasharray="10 8"
      />
      <circle
        cx="120"
        cy="120"
        r="102"
        stroke="#FEF08A"
        strokeOpacity="0.24"
        strokeWidth="1.2"
        strokeDasharray="36 18"
      />
      <circle cx="120" cy="8" r="3.5" fill="#FFEA00" />
      <circle cx="120" cy="232" r="3.5" fill="#FFEA00" />
      <circle cx="8" cy="120" r="3.5" fill="#FACC15" />
      <circle cx="232" cy="120" r="3.5" fill="#FACC15" />
    </svg>

    {/* Main 3D Futuristic Coin Core */}
    <svg viewBox="0 0 200 200" fill="none" className="relative z-10 h-[84%] w-[84%]">
      <defs>
        <radialGradient id="coreDarkBg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#26220F" />
          <stop offset="65%" stopColor="#12110A" />
          <stop offset="100%" stopColor="#070709" />
        </radialGradient>
        <linearGradient id="neonRimGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FEF08A" />
          <stop offset="50%" stopColor="#FFEA00" />
          <stop offset="100%" stopColor="#EAB308" />
        </linearGradient>
      </defs>

      {/* Outer Metallic Dark Ring */}
      <circle
        cx="100"
        cy="100"
        r="88"
        fill="url(#coreDarkBg)"
        stroke="url(#neonRimGrad)"
        strokeWidth="4"
      />

      {/* Inner Hexagonal Cyber Frame */}
      <polygon
        points="100,24 166,62 166,138 100,176 34,138 34,62"
        fill="#14130B"
        stroke="#FACC15"
        strokeOpacity="0.55"
        strokeWidth="2"
      />

      {/* Glowing Core Circle */}
      <circle
        cx="100"
        cy="94"
        r="46"
        fill="#1C190D"
        stroke="url(#neonRimGrad)"
        strokeWidth="3"
      />

      {/* Stylized COINOVA "C" Bolt Emblem */}
      <path
        d="M114 74C109 69.5 102.5 67 95 67C79.5 67 68 78.8 68 94C68 109.2 79.5 121 95 121C102.5 121 109 118.5 114 114"
        stroke="url(#neonRimGrad)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M103 82L93 95H105L96 108"
        stroke="#FEF08A"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Bottom Pill inside Coin: TAP KOIN */}
      <rect
        x="52"
        y="147"
        width="96"
        height="22"
        rx="11"
        fill="#FFEA00"
      />
      <text
        x="100"
        y="162"
        textAnchor="middle"
        fill="#08080A"
        fontSize="11"
        fontWeight="900"
        letterSpacing="1.2"
      >
        TAP +{perClickCoins}
      </text>
    </svg>
  </div>
));

export const MushroomHeroCharacterSvg = CoinovaTapCoreReactor;
export const LevelUpCashCoinsIcon = CoinovaLogoMark;
export const RetroGrassSoilFooter: React.FC = () => null;

/**
 * 8. TASK & REWARD CAPSULE ICON
 */
export const GiftBoxTaskIcon: React.FC<{ className?: string }> = ({
  className = 'h-11 w-11',
}) => (
  <div
    className={`flex items-center justify-center rounded-2xl border border-[#FACC15]/40 bg-gradient-to-br from-[#211E0F] to-[#0B0B0F] p-2 shadow-[0_0_15px_rgba(255,234,0,0.14)] ${className}`}
  >
    <svg viewBox="0 0 40 40" fill="none" className="h-full w-full">
      <rect
        x="6"
        y="15"
        width="28"
        height="19"
        rx="4"
        fill="#14120A"
        stroke="#FACC15"
        strokeWidth="2"
      />
      <rect
        x="4"
        y="10"
        width="32"
        height="6"
        rx="2.5"
        fill="#24200E"
        stroke="#FFEA00"
        strokeWidth="2"
      />
      <path d="M20 10V34" stroke="#FFEA00" strokeWidth="2.5" />
      <path d="M6 23H34" stroke="#FEF08A" strokeWidth="2" />
      <path
        d="M20 10C16 5 11 6 13 10M20 10C24 5 29 6 27 10"
        stroke="#FACC15"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  </div>
);

/**
 * 8B. OFFICIAL TELEGRAM CHANNEL ICON
 */
export const TelegramChannelIcon: React.FC<{ className?: string }> = ({
  className = 'h-5 w-5',
}) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      d="M21.2 4.4L2.9 11.5C1.7 12 1.7 12.8 2.7 13.1L7.4 14.6L18.3 7.7C18.8 7.4 19.3 7.6 18.9 7.9L10.1 15.9L9.8 20.7C10.3 20.7 10.5 20.5 10.8 20.2L13.1 18L17.9 21.5C18.8 22 19.4 21.7 19.6 20.7L22.7 5.9C23 4.7 22.2 4 21.2 4.4Z"
      fill="currentColor"
    />
  </svg>
);

/**
 * 9. OFFICIAL E-WALLET LOGOS FOR WITHDRAW PAGE (DANA, GoPay, OVO, ShopeePay)
 */
export const EWalletLogoSvg: React.FC<{
  method: 'DANA' | 'GoPay' | 'OVO' | 'ShopeePay';
  className?: string;
}> = ({ method, className = 'h-7 w-full' }) => {
  if (method === 'DANA') {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        title="DANA"
      >
        <div className="inline-flex items-center gap-1.5 rounded-lg bg-[#118EEA] px-2.5 py-1 shadow-[0_2px_10px_rgba(17,142,234,0.35)]">
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0">
            <circle cx="12" cy="12" r="10" fill="white" />
            <path
              d="M6.5 12.2C8.2 10.4 10.1 10.4 12 12C13.9 13.6 15.8 13.6 17.5 11.8"
              stroke="#118EEA"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          </svg>
          <span className="font-sans text-[10px] font-black tracking-wider text-white">
            DANA
          </span>
        </div>
      </div>
    );
  }
  if (method === 'GoPay') {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        title="GoPay"
      >
        <div className="inline-flex items-center gap-1 rounded-lg bg-[#00AED6] px-2.5 py-1 shadow-[0_2px_10px_rgba(0,174,214,0.35)]">
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0">
            <rect x="2.5" y="5" width="19" height="14" rx="3.5" fill="white" />
            <circle cx="15.5" cy="12" r="2.2" fill="#00AED6" />
          </svg>
          <span className="font-sans text-[10px] font-black tracking-tight text-white lowercase">
            gopay
          </span>
        </div>
      </div>
    );
  }
  if (method === 'OVO') {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        title="OVO"
      >
        <div className="inline-flex items-center justify-center rounded-lg bg-[#4C3494] px-3 py-1 shadow-[0_2px_10px_rgba(76,52,148,0.4)]">
          <svg viewBox="0 0 54 20" fill="none" className="h-3.5 w-9">
            <circle cx="9" cy="10" r="6" stroke="white" strokeWidth="3.2" />
            <path
              d="M20 4L26.5 16L33 4"
              stroke="white"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="44" cy="10" r="6" stroke="white" strokeWidth="3.2" />
          </svg>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`flex items-center justify-center ${className}`}
      title="ShopeePay"
    >
      <div className="inline-flex items-center gap-1 rounded-lg bg-[#EE4D2D] px-2 py-1 shadow-[0_2px_10px_rgba(238,77,45,0.35)]">
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0">
          <path
            d="M8.5 7.5V6.5C8.5 4.6 10.1 3 12 3C13.9 3 15.5 4.6 15.5 6.5V7.5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M5 7.5H19L17.8 19.2C17.6 20.2 16.8 21 15.8 21H8.2C7.2 21 6.4 20.2 6.2 19.2L5 7.5Z"
            fill="white"
          />
          <path
            d="M13.8 11.2C13.2 10.6 12.4 10.3 11.6 10.3C10.4 10.3 9.7 10.9 9.7 11.8C9.7 12.7 10.6 13.1 12 13.5C13.5 13.9 14.3 14.5 14.3 15.7C14.3 17 13.2 17.8 11.6 17.8C10.4 17.8 9.5 17.3 9 16.5"
            stroke="#EE4D2D"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span className="font-sans text-[9.5px] font-black tracking-tight text-white">
          ShopeePay
        </span>
      </div>
    </div>
  );
};

export const EWalletMethodCircleIcon = EWalletLogoSvg;

/**
 * 10. MODERN FUTURISTIC BOTTOM NAVIGATION ICONS (Home, Task, Invite, Withdraw, Profile)
 */
export const BottomNavHomeIcon: React.FC<{ className?: string }> = ({
  className = 'h-5 w-5',
}) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      d="M3 10.5L12 3L21 10.5V19.5C21 20.3284 20.3284 21 19.5 21H4.5C3.67157 21 3 20.3284 3 19.5V10.5Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="M9.5 21V14H14.5V21"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const BottomNavTaskIcon: React.FC<{ className?: string }> = ({
  className = 'h-5 w-5',
}) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect
      x="4"
      y="3.5"
      width="16"
      height="17"
      rx="3"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M8.5 9.5L10.5 11.5L15.5 7.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8.5 15.5H15.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export const BottomNavInviteIcon: React.FC<{ className?: string }> = ({
  className = 'h-5 w-5',
}) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="9" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="2" />
    <path
      d="M3 19.5C3 16.4624 5.68629 14 9 14C12.3137 14 15 16.4624 15 19.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M18 8V14M15 11H21"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

export const BottomNavWithdrawIcon: React.FC<{ className?: string }> = ({
  className = 'h-5 w-5',
}) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect
      x="3"
      y="5.5"
      width="18"
      height="13"
      rx="3"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M15.5 12H21"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <circle cx="15.5" cy="12" r="1.5" fill="currentColor" />
  </svg>
);

export const BottomNavProfileIcon: React.FC<{ className?: string }> = ({
  className = 'h-5 w-5',
}) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
    <path
      d="M4.5 20C4.5 16.4101 7.85786 13.5 12 13.5C16.1421 13.5 19.5 16.4101 19.5 20"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);
