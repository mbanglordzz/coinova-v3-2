import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdminAuditLog,
  AdminBroadcastRecord,
  CreatorStatus,
  CreatorSubmission,
  CurrencyType,
  DragonLevelConfig,
  GameSettings,
  GameTask,
  LevelUpgradeOrder,
  ReferralRecord,
  RewardCode,
  TaskCategory,
  TaskMetricType,
  UserAccount,
  UserWallet,
  VipOrderRecord,
  WalletTransaction,
  WithdrawalRecord,
  WithdrawalStatus,
} from '../types/dragon';
import {
  calculateCoinsFromIdr,
  calculateIdrFromCoins,
  calculateRequiredFireForWithdrawal,
} from '../config/economy';
import {
  AlertNeonIcon,
  ArrowBackIcon,
  CheckCircleNeonIcon,
  ClockNeonIcon,
  CloseIcon,
  CopyNeonIcon,
  DiamondIcon,
  DragonCoinIcon,
  EWalletBrandBadge,
  ExportCsvNeonIcon,
  ExternalLinkNeonIcon,
  EyeNeonIcon,
  GiftIcon,
  HistoryIcon,
  LevelBadgeIcon,
  LockNeonIcon,
  LogoutNeonIcon,
  NavHomeIcon,
  NavInviteIcon,
  NavTaskIcon,
  NavWithdrawIcon,
  PlusNeonIcon,
  SettingsIcon,
  ShieldNeonIcon,
  UploadNeonIcon,
  XCircleNeonIcon,
} from './DragonIcons';
import { CoinovaLogoMark } from './GameIllustrations';

export interface AdminSessionInfo {
  uid: string;
  username: string;
  role: 'ADMIN';
  token: string;
}

interface AdminDashboardProps {
  adminSession: AdminSessionInfo | null;
  onAdminLoginSuccess: (session: AdminSessionInfo) => void;
  onAdminLogout: () => Promise<void>;
  onExitToUserApp: () => void;
  users: UserAccount[];
  wallets: UserWallet[];
  tasks: GameTask[];
  rewardCodes: RewardCode[];
  referrals: ReferralRecord[];
  creatorSubmissions: CreatorSubmission[];
  withdrawals: WithdrawalRecord[];
  upgradeOrders: LevelUpgradeOrder[];
  transactions: WalletTransaction[];
  levels: DragonLevelConfig[];
  settings: GameSettings;
  auditLogs: AdminAuditLog[];
  onProcessWithdrawal: (
    w: WithdrawalRecord,
    nextStatus: WithdrawalStatus,
    paymentRef: string,
    note: string
  ) => Promise<void>;
  onReviewUpgradeOrder: (
    order: LevelUpgradeOrder,
    nextStatus: 'PAID' | 'REJECTED',
    note: string
  ) => Promise<void>;
  onProcessReferral?: (
    ref: ReferralRecord,
    milestone: 'ACTIVE' | 'VERIFIED' | 'UPGRADE' | 'REJECTED'
  ) => Promise<void>;
  onReviewCreator: (
    sub: CreatorSubmission,
    nextStatus: CreatorStatus,
    coinReward: number,
    fireReward: number,
    idrReward: number,
    note: string
  ) => Promise<void>;
  onAdjustUserBalance: (
    targetUid: string,
    currency: CurrencyType,
    delta: number,
    reason: string
  ) => Promise<void>;
  onToggleUserSuspend: (
    targetUid: string,
    currentStatus: 'active' | 'suspended'
  ) => Promise<void>;
  onSaveTask: (task: GameTask) => Promise<void>;
  onSaveRewardCode: (rc: RewardCode) => Promise<void>;
  onSaveLevelConfig: (lvl: DragonLevelConfig) => Promise<void>;
  onSaveGameSettings: (settings: GameSettings) => Promise<void>;
  busyAction: string | null;
}

type AdminTab =
  | 'DASHBOARD'
  | 'USERS'
  | 'VIP'
  | 'BROADCAST'
  | 'CODES'
  | 'TASKS'
  | 'LEVELS'
  | 'CREATORS'
  | 'FINANCE'
  | 'QRIS'
  | 'SETTINGS'
  | 'AUDIT';

type FinanceSubTab = 'WITHDRAWALS' | 'UPGRADE_ORDERS' | 'REFERRALS' | 'TRANSACTIONS';

interface FraudEventItem {
  eventId: string;
  uid: string;
  reason: string;
  deltaMs: number;
  tapId: string;
  status: 'FLAGGED' | 'CLEARED' | 'SUSPENDED';
  createdAt: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  adminSession,
  onAdminLoginSuccess,
  onAdminLogout,
  onExitToUserApp,
  users,
  wallets,
  tasks,
  rewardCodes,
  referrals,
  creatorSubmissions,
  withdrawals,
  upgradeOrders,
  transactions,
  levels,
  settings,
  auditLogs,
  onProcessWithdrawal,
  onReviewUpgradeOrder,
  onProcessReferral,
  onReviewCreator,
  onAdjustUserBalance,
  onToggleUserSuspend,
  onSaveTask,
  onSaveRewardCode,
  onSaveLevelConfig,
  onSaveGameSettings,
  busyAction,
}) => {
  // Dedicated Admin Login State
  const [loginUsername, setLoginUsername] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<AdminTab>('DASHBOARD');
  const [financeSubTab, setFinanceSubTab] = useState<FinanceSubTab>('WITHDRAWALS');

  // Local Action Feedback Banner inside Admin Panel
  const [localFeedback, setLocalFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const notifyAdmin = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      setLocalFeedback({ message, type });
      window.setTimeout(() => {
        setLocalFeedback((prev) => (prev?.message === message ? null : prev));
      }, 3200);
    },
    []
  );

  // Server Overview Merged Data
  const [hasLoadedServerOverview, setHasLoadedServerOverview] = useState<boolean>(false);
  const [serverUsers, setServerUsers] = useState<UserAccount[]>([]);
  const [serverWallets, setServerWallets] = useState<UserWallet[]>([]);
  const [serverWithdrawals, setServerWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [serverUpgradeOrders, setServerUpgradeOrders] = useState<LevelUpgradeOrder[]>([]);
  const [serverReferrals, setServerReferrals] = useState<ReferralRecord[]>([]);
  const [serverCreatorSubmissions, setServerCreatorSubmissions] = useState<CreatorSubmission[]>([]);
  const [serverTransactions, setServerTransactions] = useState<WalletTransaction[]>([]);
  const [serverAuditLogs, setServerAuditLogs] = useState<AdminAuditLog[]>([]);
  const [isRefreshingOverview, setIsRefreshingOverview] = useState<boolean>(false);

  // Withdrawal Processing State
  const [selectedWithdrawId, setSelectedWithdrawId] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState<string>('');
  const [adminNote, setAdminNote] = useState<string>('');
  const [withdrawStatusFilter, setWithdrawStatusFilter] = useState<string>('ALL');

  // Upgrade Order Processing State
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderAdminNote, setOrderAdminNote] = useState<string>('');
  const [previewProofOrder, setPreviewProofOrder] = useState<LevelUpgradeOrder | null>(
    null
  );

  // Balance Adjustment & User Filter State
  const [adjustUid, setAdjustUid] = useState<string>('');
  const [adjustCurrency, setAdjustCurrency] = useState<CurrencyType>('COIN');
  const [adjustDelta, setAdjustDelta] = useState<string>('1000');
  const [adjustReason, setAdjustReason] = useState<string>('Bonus Event Admin');
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');
  const [userStatusFilter, setUserStatusFilter] = useState<'ALL' | 'active' | 'suspended'>('ALL');
  const [suspendedUidOverrides, setSuspendedUidOverrides] = useState<
    Record<string, 'active' | 'suspended'>
  >({});

  // Task Form (Create & Edit)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState<string>('');
  const [newTaskDesc, setNewTaskDesc] = useState<string>('');
  const [newTaskCategory, setNewTaskCategory] = useState<TaskCategory>('DAILY');
  const [newTaskMetric, setNewTaskMetric] = useState<TaskMetricType>('TAPS');
  const [newTaskTarget, setNewTaskTarget] = useState<string>('100');
  const [newTaskCoins, setNewTaskCoins] = useState<string>('500');
  const [newTaskFire, setNewTaskFire] = useState<string>('2');
  const [newTaskIdr] = useState<string>('0');

  // Reward Code Form (Create & Edit)
  const [editingCodeKey, setEditingCodeKey] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string>('');
  const [newCodeDesc, setNewCodeDesc] = useState<string>('');
  const [newCodeCoins, setNewCodeCoins] = useState<string>('1000');
  const [newCodeFire, setNewCodeFire] = useState<string>('5');
  const [newCodeIdr] = useState<string>('0');
  const [newCodeMax, setNewCodeMax] = useState<string>('100');
  const [newCodeExpiresAt, setNewCodeExpiresAt] = useState<string>('');
  const [isSavingPromo, setIsSavingPromo] = useState<boolean>(false);
  const [promoCodes, setPromoCodes] = useState<RewardCode[]>([]);
  const [promoClaims, setPromoClaims] = useState<
    Array<{
      claimId: string;
      code: string;
      uid: string;
      username: string;
      coinReward: number;
      fireReward: number;
      claimedAt: string;
    }>
  >([]);

  // Level Editing State
  const [editingLevelNum, setEditingLevelNum] = useState<number | null>(null);
  const [editLevelName, setEditLevelName] = useState<string>('');
  const [editLevelPrice, setEditLevelPrice] = useState<string>('0');
  const [editLevelMultiplier, setEditLevelMultiplier] = useState<string>('1');
  const [editLevelEnergy, setEditLevelEnergy] = useState<string>('500');
  const [editLevelFireBonus, setEditLevelFireBonus] = useState<string>('0');

  // Creator Review Custom State
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | null>(null);
  const [creatorCoinInput, setCreatorCoinInput] = useState<string>('3000');
  const [creatorFireInput, setCreatorFireInput] = useState<string>('5');
  const [creatorNoteInput, setCreatorNoteInput] = useState<string>('');

  // Transaction Search State
  const [txSearchQuery, setTxSearchQuery] = useState<string>('');

  // Game Settings Form
  const [editSettings, setEditSettings] = useState<GameSettings>(settings);
  const [fraudEvents, setFraudEvents] = useState<FraudEventItem[]>([]);

  // Dynamic QRIS Admin State
  const [activeQris, setActiveQris] = useState<{
    hasQris: boolean;
    imageDataUrl: string | null;
    fileName: string;
    mimeType: string;
    fileSize: number;
    updatedBy: string;
    updatedAt: string | null;
  }>({
    hasQris: false,
    imageDataUrl: null,
    fileName: '',
    mimeType: '',
    fileSize: 0,
    updatedBy: '',
    updatedAt: null,
  });
  const [draftQrisDataUrl, setDraftQrisDataUrl] = useState<string | null>(null);
  const [draftQrisMeta, setDraftQrisMeta] = useState<{
    fileName: string;
    mimeType: string;
    fileSize: number;
  } | null>(null);
  const [qrisError, setQrisError] = useState<string | null>(null);
  const [isLoadingQris, setIsLoadingQris] = useState<boolean>(false);
  const [isSavingQris, setIsSavingQris] = useState<boolean>(false);
  const [isDeletingQris, setIsDeletingQris] = useState<boolean>(false);
  const qrisFileInputRef = useRef<HTMLInputElement | null>(null);

  // Admin VIP Management State
  const [vipOrders, setVipOrders] = useState<VipOrderRecord[]>([]);
  const [vipMembers, setVipMembers] = useState<
    Array<{
      uid: string;
      username: string;
      vipStatus: 'ACTIVE' | 'EXPIRED' | 'PENDING' | 'NONE';
      isVip: boolean;
      vipStartedAt: string | null;
      vipExpiresAt: string | null;
      dragonLevel: number;
    }>
  >([]);
  const [isLoadingVipData, setIsLoadingVipData] = useState<boolean>(false);
  const [vipBusyOrderId, setVipBusyOrderId] = useState<string | null>(null);
  const [vipNoteInputMap, setVipNoteInputMap] = useState<Record<string, string>>({});
  const [previewVipProofOrder, setPreviewVipProofOrder] = useState<VipOrderRecord | null>(null);
  const [vipMemberFilter, setVipMemberFilter] = useState<'ALL' | 'ACTIVE' | 'EXPIRED'>('ALL');

  // Admin Broadcast Management State
  const [serverBroadcasts, setServerBroadcasts] = useState<AdminBroadcastRecord[]>([]);
  const [broadcastTitleInput, setBroadcastTitleInput] = useState<string>('');
  const [broadcastContentInput, setBroadcastContentInput] = useState<string>('');
  const [broadcastIsActiveInput, setBroadcastIsActiveInput] = useState<boolean>(true);
  const [isSavingBroadcast, setIsSavingBroadcast] = useState<boolean>(false);

  const fetchAdminVipAndPromoAndBroadcasts = useCallback(async () => {
    if (!adminSession?.token) return;
    setIsLoadingVipData(true);
    try {
      const headers = { Authorization: `Bearer ${adminSession.token}` };
      const [vipRes, bcRes, prRes] = await Promise.all([
        fetch(`/api/admin/vip?t=${Date.now()}`, { headers, cache: 'no-store' }),
        fetch(`/api/admin/broadcasts?t=${Date.now()}`, { headers, cache: 'no-store' }),
        fetch(`/api/admin/promo?t=${Date.now()}`, { headers, cache: 'no-store' }),
      ]);
      if (vipRes.ok) {
        const vipData = await vipRes.json();
        if (vipData?.ok) {
          setVipOrders(Array.isArray(vipData.orders) ? vipData.orders : []);
          const memberList = Array.isArray(vipData.vipUsers)
            ? vipData.vipUsers
            : Array.isArray(vipData.members)
            ? vipData.members
            : [];
          setVipMembers(memberList);
        }
      }
      if (bcRes.ok) {
        const bcData = await bcRes.json();
        if (bcData?.ok && Array.isArray(bcData.broadcasts)) {
          setServerBroadcasts(bcData.broadcasts);
        }
      }
      if (prRes.ok) {
        const prData = await prRes.json();
        if (prData?.ok) {
          if (Array.isArray(prData.promoCodes)) setPromoCodes(prData.promoCodes);
          if (Array.isArray(prData.claims)) setPromoClaims(prData.claims);
        }
      }
    } catch {
      // ignore network error
    } finally {
      setIsLoadingVipData(false);
    }
  }, [adminSession?.token]);

  useEffect(() => {
    void fetchAdminVipAndPromoAndBroadcasts();
  }, [fetchAdminVipAndPromoAndBroadcasts, activeTab]);

  const handleVerifyVipOrder = async (
    orderId: string,
    decision: 'APPROVED' | 'REJECTED',
    customNote?: string
  ) => {
    if (!adminSession?.token || vipBusyOrderId) return;
    setVipBusyOrderId(orderId);
    try {
      const res = await fetch('/api/admin/vip/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSession.token}`,
        },
        body: JSON.stringify({
          orderId,
          decision,
          adminNote:
            customNote ??
            vipNoteInputMap[orderId] ??
            (decision === 'APPROVED'
              ? 'Pembayaran VIP Rp100.000 diverifikasi Admin. VIP aktif 30 hari.'
              : 'Bukti pembayaran VIP ditolak oleh Admin.'),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        notifyAdmin(data?.error || 'Gagal memproses order VIP.', 'error');
        return;
      }
      notifyAdmin(data.message || `Order VIP berhasil di-${decision}.`, 'success');
      setPreviewVipProofOrder(null);
      await fetchAdminVipAndPromoAndBroadcasts();
    } catch {
      notifyAdmin('Gagal menghubungi server untuk memverifikasi VIP.', 'error');
    } finally {
      setVipBusyOrderId(null);
    }
  };

  const handleCreateBroadcast = async () => {
    if (!adminSession?.token || isSavingBroadcast) return;
    if (!broadcastTitleInput.trim() || !broadcastContentInput.trim()) {
      notifyAdmin('Judul dan isi pengumuman wajib diisi.', 'error');
      return;
    }
    setIsSavingBroadcast(true);
    try {
      const res = await fetch('/api/admin/broadcasts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSession.token}`,
        },
        body: JSON.stringify({
          title: broadcastTitleInput.trim(),
          content: broadcastContentInput.trim(),
          isActive: broadcastIsActiveInput,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        notifyAdmin(data?.error || 'Gagal membuat pengumuman.', 'error');
        return;
      }
      notifyAdmin(data.message || 'Pengumuman berhasil diterbitkan!', 'success');
      setBroadcastTitleInput('');
      setBroadcastContentInput('');
      await fetchAdminVipAndPromoAndBroadcasts();
    } catch {
      notifyAdmin('Gagal menghubungi server saat menyimpan pengumuman.', 'error');
    } finally {
      setIsSavingBroadcast(false);
    }
  };

  const handleToggleBroadcastStatus = async (broadcastId: string, nextActive: boolean) => {
    if (!adminSession?.token) return;
    try {
      const res = await fetch('/api/admin/broadcasts/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSession.token}`,
        },
        body: JSON.stringify({ broadcastId, isActive: nextActive }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        notifyAdmin(
          `Pengumuman ${nextActive ? 'diaktifkan' : 'dinonaktifkan'}.`,
          'success'
        );
        await fetchAdminVipAndPromoAndBroadcasts();
      }
    } catch {
      notifyAdmin('Gagal menghubungi server.', 'error');
    }
  };

  const handleDeleteBroadcast = async (broadcastId: string) => {
    if (!adminSession?.token) return;
    try {
      const res = await fetch(`/api/admin/broadcasts/${encodeURIComponent(broadcastId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminSession.token}` },
      });
      if (res.ok) {
        notifyAdmin('Pengumuman berhasil dihapus.', 'success');
        await fetchAdminVipAndPromoAndBroadcasts();
      }
    } catch {
      notifyAdmin('Gagal menghapus pengumuman.', 'error');
    }
  };

  const handleCreatePromoCode = async () => {
    const cleanCode = newCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!cleanCode) {
      notifyAdmin('Kode redeem wajib diisi.', 'error');
      return;
    }
    setIsSavingPromo(true);
    try {
      const existing = promoCodes.find((p) => p.code === cleanCode) || rewardCodes.find((p) => p.code === cleanCode);
      const rcPayload: RewardCode = {
        code: cleanCode,
        description: newCodeDesc.trim() || `Kode Redeem ${cleanCode}`,
        coinReward: Math.max(0, Number(newCodeCoins) || 0),
        fireReward: Math.max(0, Number(newCodeFire) || 0),
        idrReward: Math.max(0, Number(newCodeIdr) || 0),
        quota: Math.max(1, Number(newCodeMax) || 100),
        maxClaims: Math.max(1, Number(newCodeMax) || 100),
        claimedCount: existing ? Number(existing.claimedCount || 0) : 0,
        expiresAt: newCodeExpiresAt ? new Date(newCodeExpiresAt).toISOString() : null,
        isActive: existing ? Boolean(existing.isActive) : true,
        updatedAt: new Date().toISOString(),
      };

      if (adminSession?.token) {
        const res = await fetch('/api/admin/promo', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminSession.token}`,
          },
          body: JSON.stringify(rcPayload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          notifyAdmin(data?.error || 'Gagal menyimpan kode redeem.', 'error');
          return;
        }
        if (Array.isArray(data.promoCodes)) {
          setPromoCodes(data.promoCodes);
        }
      }
      await onSaveRewardCode(rcPayload);
      handleCancelEditCode();
      await fetchAdminVipAndPromoAndBroadcasts();
      await fetchServerOverview();
      notifyAdmin(`Kode redeem ${cleanCode} berhasil disimpan ke database!`, 'success');
    } catch {
      notifyAdmin('Gagal menghubungi server saat menyimpan kode redeem.', 'error');
    } finally {
      setIsSavingPromo(false);
    }
  };

  const handleTogglePromoCode = async (code: string, nextActive: boolean) => {
    if (!adminSession?.token) return;
    try {
      const res = await fetch('/api/admin/promo/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSession.token}`,
        },
        body: JSON.stringify({ code, isActive: nextActive }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        if (data?.code) {
          setPromoCodes((prev) =>
            prev.map((item) =>
              item.code === code ? { ...item, ...data.code } : item
            )
          );
        }
        if (Array.isArray(data.promoCodes)) setPromoCodes(data.promoCodes);
        notifyAdmin(
          `Kode redeem ${code} berhasil ${nextActive ? 'diaktifkan' : 'dinonaktifkan'}.`,
          'success'
        );
        await fetchAdminVipAndPromoAndBroadcasts();
        await fetchServerOverview();
      } else {
        notifyAdmin(data?.error || 'Gagal mengubah status kode redeem.', 'error');
      }
    } catch {
      notifyAdmin('Gagal menghubungi server.', 'error');
    }
  };

  const handleDeletePromoCode = async (code: string) => {
    if (!adminSession?.token) return;
    try {
      const res = await fetch('/api/admin/promo/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSession.token}`,
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setPromoCodes((prev) => prev.filter((item) => item.code !== code));
        if (Array.isArray(data.promoCodes)) setPromoCodes(data.promoCodes);
        notifyAdmin(`Kode redeem ${code} berhasil dihapus.`, 'success');
        await fetchAdminVipAndPromoAndBroadcasts();
        await fetchServerOverview();
      } else {
        notifyAdmin(data?.error || 'Gagal menghapus kode redeem.', 'error');
      }
    } catch {
      notifyAdmin('Gagal menghapus kode redeem.', 'error');
    }
  };

  const fetchAdminQrisConfig = useCallback(async () => {
    if (!adminSession?.token) return;
    setIsLoadingQris(true);
    try {
      const res = await fetch(`/api/admin/qris?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${adminSession.token}` },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ok && data?.qris) {
        setActiveQris({
          hasQris: Boolean(data.qris.hasQris && data.qris.imageDataUrl),
          imageDataUrl: data.qris.imageDataUrl || null,
          fileName: String(data.qris.fileName || ''),
          mimeType: String(data.qris.mimeType || ''),
          fileSize: Number(data.qris.fileSize || 0),
          updatedBy: String(data.qris.updatedBy || ''),
          updatedAt: data.qris.updatedAt || null,
        });
      }
    } catch {
      // ignore network error
    } finally {
      setIsLoadingQris(false);
    }
  }, [adminSession?.token]);

  useEffect(() => {
    void fetchAdminQrisConfig();
  }, [fetchAdminQrisConfig, activeTab]);

  const handleSelectQrisFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQrisError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    const validExt = /\.(png|jpe?g|webp)$/i.test(file.name);
    if (!allowedMimes.includes(file.type.toLowerCase()) || !validExt) {
      setQrisError(
        'Format file tidak didukung. Gunakan gambar PNG, JPG, JPEG, atau WebP.'
      );
      if (qrisFileInputRef.current) qrisFileInputRef.current.value = '';
      return;
    }

    const maxBytes = 5 * 1024 * 1024; // 5 MB
    if (file.size > maxBytes) {
      setQrisError(
        'Ukuran gambar QRIS melebihi 5 MB. Maksimal ukuran file adalah 5 MB.'
      );
      if (qrisFileInputRef.current) qrisFileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      setQrisError('Gagal membaca file gambar QRIS.');
    };
    reader.onload = () => {
      const resultStr = String(reader.result || '');
      if (!resultStr.startsWith('data:image/')) {
        setQrisError('File gambar QRIS tidak valid.');
        return;
      }
      setDraftQrisDataUrl(resultStr);
      setDraftQrisMeta({
        fileName: file.name,
        mimeType: file.type.toLowerCase(),
        fileSize: file.size,
      });
    };
    reader.readAsDataURL(file);
    if (qrisFileInputRef.current) {
      qrisFileInputRef.current.value = '';
    }
  };

  const handleSaveQris = async () => {
    if (!adminSession?.token) return;
    if (!draftQrisDataUrl || !draftQrisMeta) {
      setQrisError('Silakan pilih file gambar QRIS terlebih dahulu sebelum menekan Simpan QRIS.');
      return;
    }
    setQrisError(null);
    setIsSavingQris(true);
    try {
      const res = await fetch('/api/admin/qris', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSession.token}`,
        },
        body: JSON.stringify({
          imageDataUrl: draftQrisDataUrl,
          fileName: draftQrisMeta.fileName,
          mimeType: draftQrisMeta.mimeType,
          fileSize: draftQrisMeta.fileSize,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const msg = data?.error || 'Gagal menyimpan QRIS pembayaran.';
        setQrisError(msg);
        notifyAdmin(msg, 'error');
        return;
      }
      setActiveQris({
        hasQris: Boolean(data.qris?.hasQris && data.qris?.imageDataUrl),
        imageDataUrl: data.qris?.imageDataUrl || null,
        fileName: String(data.qris?.fileName || draftQrisMeta.fileName),
        mimeType: String(data.qris?.mimeType || draftQrisMeta.mimeType),
        fileSize: Number(data.qris?.fileSize || draftQrisMeta.fileSize),
        updatedBy: String(data.qris?.updatedBy || adminSession.username),
        updatedAt: data.qris?.updatedAt || new Date().toISOString(),
      });
      setDraftQrisDataUrl(null);
      setDraftQrisMeta(null);
      notifyAdmin('QRIS pembayaran berhasil disimpan dan diaktifkan!', 'success');
      fetchServerOverview();
    } catch {
      setQrisError('Gagal menghubungi server saat menyimpan QRIS.');
      notifyAdmin('Gagal menghubungi server saat menyimpan QRIS.', 'error');
    } finally {
      setIsSavingQris(false);
    }
  };

  const handleDeleteQris = async () => {
    if (!adminSession?.token || isDeletingQris) return;
    setQrisError(null);
    setIsDeletingQris(true);
    try {
      const res = await fetch('/api/admin/qris', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${adminSession.token}`,
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const msg = data?.error || 'Gagal menghapus QRIS pembayaran.';
        setQrisError(msg);
        notifyAdmin(msg, 'error');
        return;
      }
      setActiveQris({
        hasQris: false,
        imageDataUrl: null,
        fileName: '',
        mimeType: '',
        fileSize: 0,
        updatedBy: adminSession.username,
        updatedAt: new Date().toISOString(),
      });
      setDraftQrisDataUrl(null);
      setDraftQrisMeta(null);
      notifyAdmin('QRIS pembayaran berhasil dihapus.', 'success');
      fetchServerOverview();
    } catch {
      setQrisError('Gagal menghubungi server saat menghapus QRIS.');
      notifyAdmin('Gagal menghubungi server saat menghapus QRIS.', 'error');
    } finally {
      setIsDeletingQris(false);
    }
  };

  useEffect(() => {
    setEditSettings(settings);
  }, [settings]);

  const fetchServerOverview = useCallback(async () => {
    if (!adminSession?.token) return;
    setIsRefreshingOverview(true);
    try {
      const [ovResp, frResp] = await Promise.all([
        fetch(`/api/admin/overview?t=${Date.now()}`, {
          headers: { Authorization: `Bearer ${adminSession.token}` },
          cache: 'no-store',
        }),
        fetch(`/api/admin/fraud-review?t=${Date.now()}`, {
          headers: { Authorization: `Bearer ${adminSession.token}` },
          cache: 'no-store',
        }),
      ]);
      if (ovResp.ok) {
        const ovData = await ovResp.json();
        if (ovData?.ok) {
          setHasLoadedServerOverview(true);
          if (Array.isArray(ovData.users)) setServerUsers(ovData.users);
          if (Array.isArray(ovData.wallets)) setServerWallets(ovData.wallets);
          if (Array.isArray(ovData.withdrawals)) setServerWithdrawals(ovData.withdrawals);
          if (Array.isArray(ovData.upgradeOrders)) setServerUpgradeOrders(ovData.upgradeOrders);
          if (Array.isArray(ovData.referrals)) setServerReferrals(ovData.referrals);
          if (Array.isArray(ovData.creatorSubmissions)) {
            setServerCreatorSubmissions(ovData.creatorSubmissions);
          }
          if (Array.isArray(ovData.transactions)) setServerTransactions(ovData.transactions);
          if (Array.isArray(ovData.auditLogs)) setServerAuditLogs(ovData.auditLogs);
          if (Array.isArray(ovData.promoCodes)) setPromoCodes(ovData.promoCodes);
          if (Array.isArray(ovData.promoClaims)) setPromoClaims(ovData.promoClaims);
        }
      }
      if (frResp.ok) {
        const frData = await frResp.json();
        if (frData?.ok && Array.isArray(frData.events)) {
          setFraudEvents(frData.events);
        }
      }
    } catch {
      // ignore network error on background sync
    } finally {
      setIsRefreshingOverview(false);
    }
  }, [adminSession?.token]);

  useEffect(() => {
    if (!adminSession?.token) return;
    void fetchServerOverview();
    const timer = window.setInterval(() => {
      void fetchServerOverview();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [fetchServerOverview, activeTab, adminSession?.token]);

  // Authoritative synchronization with server overview
  const mergedUsers = useMemo(() => {
    const source = hasLoadedServerOverview ? serverUsers : users;
    const map = new Map<string, UserAccount>();
    source.forEach((u) => {
      if (!u?.uid) return;
      const uname = String(u.username || '').trim();
      const unameLower = uname.toLowerCase();
      if (
        !uname ||
        unameLower === 'member' ||
        unameLower === 'player' ||
        unameLower === 'guest' ||
        unameLower === 'user' ||
        unameLower === 'anonymous'
      ) {
        return;
      }
      if (String(u.role || '').toUpperCase() === 'ADMIN' || String(u.uid).startsWith('admin_')) {
        return;
      }
      map.set(u.uid, u);
    });
    return Array.from(map.values()).map((u) => ({
      ...u,
      status: suspendedUidOverrides[u.uid] || u.status || 'active',
    }));
  }, [hasLoadedServerOverview, users, serverUsers, suspendedUidOverrides]);

  const mergedWallets = useMemo(() => {
    const source = hasLoadedServerOverview ? serverWallets : wallets;
    const map = new Map<string, UserWallet>();
    source.forEach((w) => {
      if (w?.uid) map.set(w.uid, w);
    });
    return Array.from(map.values());
  }, [hasLoadedServerOverview, wallets, serverWallets]);

  const mergedWithdrawals = useMemo(() => {
    const source = hasLoadedServerOverview ? serverWithdrawals : withdrawals;
    const map = new Map<string, WithdrawalRecord>();
    source.forEach((w) => {
      if (w?.withdrawalId) map.set(w.withdrawalId, w);
    });
    return Array.from(map.values())
      .map((w) => {
        const matchedUser = mergedUsers.find((u) => u.uid === w.uid);
        const resolvedUsername =
          w.username && w.username.trim().toLowerCase() !== 'member'
            ? w.username
            : matchedUser?.username || w.accountName || w.uid;
        return {
          ...w,
          username: resolvedUsername,
        };
      })
      .sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      );
  }, [hasLoadedServerOverview, withdrawals, serverWithdrawals, mergedUsers]);

  const mergedUpgradeOrders = useMemo(() => {
    const source = hasLoadedServerOverview ? serverUpgradeOrders : upgradeOrders;
    const map = new Map<string, LevelUpgradeOrder>();
    source.forEach((o) => {
      if (o?.orderId) map.set(o.orderId, o);
    });
    return Array.from(map.values()).sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    );
  }, [hasLoadedServerOverview, upgradeOrders, serverUpgradeOrders]);

  const mergedReferrals = useMemo(() => {
    const source = hasLoadedServerOverview ? serverReferrals : referrals;
    const map = new Map<string, ReferralRecord>();
    source.forEach((r) => {
      if (r?.referralId) map.set(r.referralId, r);
    });
    return Array.from(map.values()).sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    );
  }, [hasLoadedServerOverview, referrals, serverReferrals]);

  const mergedCreatorSubmissions = useMemo(() => {
    const source = hasLoadedServerOverview ? serverCreatorSubmissions : creatorSubmissions;
    const map = new Map<string, CreatorSubmission>();
    source.forEach((c) => {
      if (c?.submissionId) map.set(c.submissionId, c);
    });
    return Array.from(map.values()).sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    );
  }, [hasLoadedServerOverview, creatorSubmissions, serverCreatorSubmissions]);

  const mergedTransactions = useMemo(() => {
    const source = hasLoadedServerOverview ? serverTransactions : transactions;
    const map = new Map<string, WalletTransaction>();
    source.forEach((t) => {
      if (t?.id) map.set(t.id, t);
    });
    return Array.from(map.values()).sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    );
  }, [hasLoadedServerOverview, transactions, serverTransactions]);

  const mergedAuditLogs = useMemo(() => {
    const source = hasLoadedServerOverview ? serverAuditLogs : auditLogs;
    const map = new Map<string, AdminAuditLog>();
    source.forEach((l) => {
      if (l?.id) map.set(l.id, l);
    });
    auditLogs.forEach((l) => {
      if (l?.id && !map.has(l.id)) map.set(l.id, l);
    });
    return Array.from(map.values()).sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    );
  }, [hasLoadedServerOverview, auditLogs, serverAuditLogs]);

  // ============================================================================
  // DEDICATED SEPARATE ADMIN LOGIN SCREEN (SERVER-SIDE HASHED AUTHENTICATION)
  // ============================================================================
  const handleAdminLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword || isLoggingIn) return;
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const resp = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });

      let data: any = null;
      try {
        data = await resp.json();
      } catch {
        setLoginError('Server admin sedang bermasalah. Coba lagi.');
        return;
      }

      if (resp.status >= 500) {
        setLoginError(data?.error || 'Server admin sedang bermasalah. Coba lagi.');
        return;
      }

      if (!resp.ok || !data?.ok || !data?.token) {
        setLoginError(data?.error || 'Username atau password admin salah.');
        return;
      }

      onAdminLoginSuccess({
        uid: data.admin.uid,
        username: data.admin.username,
        role: 'ADMIN',
        token: data.token,
      });
      setLoginPassword('');
    } catch {
      setLoginError('Server admin sedang bermasalah. Coba lagi.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (!adminSession || adminSession.role !== 'ADMIN') {
    return (
      <div className="coinova-hud-bg flex min-h-screen items-center justify-center bg-[#060608] p-4 text-white">
        <div className="coinova-card-glow w-full max-w-[400px] rounded-3xl border border-[#FFEA00]/45 bg-[#0C0C10] p-6 shadow-[0_0_32px_rgba(255,234,0,0.18)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#FFEA00]/55 bg-[#18160C] text-[#FFEA00] shadow-[0_0_14px_rgba(255,234,0,0.2)]">
                <CoinovaLogoMark className="h-7 w-7" />
              </div>
              <div>
                <h1 className="text-base font-extrabold tracking-wide text-white">
                  Admin Security Portal
                </h1>
                <p className="text-[11px] font-bold text-[#FFEA00]">
                  Otorisasi Khusus Administrator COINOVA
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onExitToUserApp}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#FFEA00]/40 bg-[#12110B] text-[#FFEA00] transition hover:border-[#FFEA00]"
              title="Kembali ke Aplikasi"
            >
              <ArrowBackIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-[#FACC15]/30 bg-[#09090C] p-3 text-xs text-zinc-300">
            <LockNeonIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#FFEA00]" />
            <span>
              Halaman ini dilindungi otorisasi server terpisah. Akun pemain biasa tidak memiliki akses ke panel ini.
            </span>
          </div>

          <form onSubmit={handleAdminLoginSubmit} className="mt-4 space-y-3.5">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-zinc-300">
                Username Admin
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={loginUsername}
                onChange={(e) => {
                  setLoginUsername(e.target.value);
                  setLoginError(null);
                }}
                placeholder="Masukkan username admin"
                className="h-11 w-full rounded-xl border border-[#FACC15]/35 bg-[#09090C] px-3.5 text-xs font-bold text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-zinc-300">
                Password Admin
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => {
                  setLoginPassword(e.target.value);
                  setLoginError(null);
                }}
                placeholder="••••••••••••"
                className="h-11 w-full rounded-xl border border-[#FACC15]/35 bg-[#09090C] px-3.5 text-xs font-bold text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
              />
            </div>

            {loginError && (
              <div className="flex items-start gap-2 rounded-xl border border-red-400/50 bg-red-500/15 p-3 text-xs font-semibold text-red-300">
                <AlertNeonIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn || !loginUsername.trim() || !loginPassword}
              className="h-11 w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(255,234,0,0.35)] transition active:scale-[0.99] disabled:opacity-40"
            >
              {isLoggingIn ? 'Memverifikasi Kredensial...' : 'Login Admin Panel'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Summary Metrics Calculation for Dashboard
  const totalUsersCount = mergedUsers.length;
  const activeUsersCount = mergedUsers.filter((u) => u.status === 'active').length;
  const totalTransactionsCount = mergedTransactions.length;
  const totalWithdrawalsCount = mergedWithdrawals.length;
  const pendingWithdrawalsCount = mergedWithdrawals.filter(
    (w) => w.status === 'PENDING' || w.status === 'PROCESSING'
  ).length;
  const pendingUpgradeOrdersCount = mergedUpgradeOrders.filter(
    (o) => o.status === 'PENDING_VERIFICATION' || o.status === 'WAITING_PAYMENT'
  ).length;
  const totalCoinsCirculating = mergedWallets.reduce(
    (sum, w) => sum + (Number(w.coinBalance) || 0),
    0
  );
  const activeTasksCount = tasks.filter((t) => t.isActive).length;

  const handleExportWithdrawalsCsv = () => {
    const headers = [
      'ID',
      'Username',
      'Metode',
      'Nomor Akun',
      'Nama Akun',
      'Nominal IDR',
      'Coin Dipotong',
      'Diamond Dipotong',
      'Status',
      'Referensi',
      'Waktu',
    ];
    const rows = mergedWithdrawals.map((w) => [
      w.withdrawalId,
      w.username,
      w.method,
      w.accountNumber,
      `"${w.accountName}"`,
      w.amount,
      w.coinDeducted || calculateCoinsFromIdr(w.amount),
      w.fireDeducted || calculateRequiredFireForWithdrawal(w.amount),
      w.status,
      w.paymentReference || '-',
      w.createdAt,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `coinova_withdrawals_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    notifyAdmin('File CSV data penarikan berhasil diunduh.', 'success');
  };

  const pendingVipOrdersCount = vipOrders.filter(
    (o) => o.status === 'PENDING_VERIFICATION'
  ).length;

  const navMenuItems: {
    id: AdminTab;
    label: string;
    badge?: number;
    icon: React.FC<{ className?: string }>;
  }[] = [
    { id: 'DASHBOARD', label: 'Dashboard', icon: NavHomeIcon },
    { id: 'USERS', label: 'Users', badge: totalUsersCount, icon: NavInviteIcon },
    { id: 'VIP', label: 'Admin VIP', badge: pendingVipOrdersCount || vipMembers.length, icon: LevelBadgeIcon },
    { id: 'BROADCAST', label: 'Broadcast', badge: serverBroadcasts.length, icon: AlertNeonIcon },
    {
      id: 'CODES',
      label: 'Kode Redeem',
      badge: promoCodes.length || rewardCodes.length,
      icon: GiftIcon,
    },
    { id: 'TASKS', label: 'Misi', badge: tasks.length, icon: NavTaskIcon },
    { id: 'LEVELS', label: 'Level', badge: levels.length, icon: LevelBadgeIcon },
    {
      id: 'CREATORS',
      label: 'Kreator',
      badge: mergedCreatorSubmissions.length,
      icon: ShieldNeonIcon,
    },
    {
      id: 'FINANCE',
      label: 'Transaksi / Withdraw',
      badge: pendingWithdrawalsCount + pendingUpgradeOrdersCount,
      icon: NavWithdrawIcon,
    },
    { id: 'QRIS', label: 'Pengaturan QRIS', icon: NavWithdrawIcon },
    { id: 'SETTINGS', label: 'Pengaturan', icon: SettingsIcon },
    { id: 'AUDIT', label: 'Audit Log', badge: mergedAuditLogs.length, icon: HistoryIcon },
  ];

  const filteredWithdrawals = [...mergedWithdrawals]
    .filter((w) => (withdrawStatusFilter === 'ALL' ? true : w.status === withdrawStatusFilter))
    .sort((a, b) => {
      const aPending = a.status === 'PENDING' || a.status === 'PROCESSING';
      const bPending = b.status === 'PENDING' || b.status === 'PROCESSING';
      if (aPending && bPending && Boolean(a.isVipPriority) !== Boolean(b.isVipPriority)) {
        return a.isVipPriority ? -1 : 1;
      }
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

  const filteredUsers = mergedUsers.filter((u) => {
    if (userStatusFilter !== 'ALL' && u.status !== userStatusFilter) {
      return false;
    }
    if (!userSearchQuery.trim()) return true;
    const q = userSearchQuery.toLowerCase();
    return (
      String(u.username || '').toLowerCase().includes(q) ||
      String(u.uid || '').toLowerCase().includes(q) ||
      String(u.referralCode || '').toLowerCase().includes(q)
    );
  });

  const filteredTransactions = mergedTransactions.filter((tx) => {
    if (!txSearchQuery.trim()) return true;
    const q = txSearchQuery.toLowerCase();
    return (
      String(tx.uid || '').toLowerCase().includes(q) ||
      String(tx.description || '').toLowerCase().includes(q) ||
      String(tx.category || '').toLowerCase().includes(q)
    );
  });

  const handleEditTaskClick = (t: GameTask) => {
    setEditingTaskId(t.taskId);
    setNewTaskTitle(t.title);
    setNewTaskDesc(t.description);
    setNewTaskCategory(t.category);
    setNewTaskMetric(t.metricType);
    setNewTaskTarget(String(t.targetCount));
    setNewTaskCoins(String(t.coinReward));
    setNewTaskFire(String(t.fireReward));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEditTask = () => {
    setEditingTaskId(null);
    setNewTaskTitle('');
    setNewTaskDesc('');
    setNewTaskCategory('DAILY');
    setNewTaskMetric('TAPS');
    setNewTaskTarget('100');
    setNewTaskCoins('500');
    setNewTaskFire('2');
  };

  const handleEditCodeClick = (rc: RewardCode) => {
    setEditingCodeKey(rc.code);
    setNewCode(rc.code);
    setNewCodeDesc(rc.description);
    setNewCodeCoins(String(rc.coinReward));
    setNewCodeFire(String(rc.fireReward));
    setNewCodeMax(String(rc.maxClaims));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEditCode = () => {
    setEditingCodeKey(null);
    setNewCode('');
    setNewCodeDesc('');
    setNewCodeCoins('1000');
    setNewCodeFire('5');
    setNewCodeMax('100');
    setNewCodeExpiresAt('');
  };

  const handleEditLevelClick = (lvl: DragonLevelConfig) => {
    setEditingLevelNum(lvl.level);
    setEditLevelName(lvl.name);
    setEditLevelPrice(String(lvl.priceIdr || 0));
    setEditLevelMultiplier(String(lvl.tapMultiplier || 1));
    setEditLevelEnergy(String(lvl.maxEnergy || 500));
    setEditLevelFireBonus(String(lvl.dailyFireBonus || 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEditLevel = () => {
    setEditingLevelNum(null);
    setEditLevelName('');
    setEditLevelPrice('0');
    setEditLevelMultiplier('1');
    setEditLevelEnergy('500');
    setEditLevelFireBonus('0');
  };

  return (
    <div className="min-h-screen bg-[#060608] pb-24 text-white">
      {/* Sticky Top Header — Mobile First & Clean */}
      <div className="sticky top-0 z-30 border-b border-[#FFEA00]/25 bg-[#0A0A0E]/95 px-3.5 py-3 backdrop-blur-md sm:px-5">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={onExitToUserApp}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#FFEA00]/45 bg-[#12110B] text-[#FFEA00] transition hover:border-[#FFEA00] active:scale-95"
              title="Kembali ke Aplikasi"
            >
              <ArrowBackIcon className="h-5 w-5" />
            </button>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#FFEA00]/45 bg-[#14130B]">
              <CoinovaLogoMark className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-extrabold tracking-wide text-white sm:text-base">
                COINOVA Admin Center
              </h1>
              <p className="truncate text-[11px] font-semibold text-[#FACC15]">
                Admin: {adminSession.username}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                fetchServerOverview();
                notifyAdmin('Data Admin berhasil disinkronkan.', 'success');
              }}
              disabled={isRefreshingOverview}
              className="hidden h-10 items-center gap-1.5 rounded-xl border border-white/15 bg-[#121217] px-3 text-xs font-bold text-zinc-200 transition hover:border-[#FFEA00]/50 hover:text-[#FFEA00] sm:inline-flex"
            >
              <span>{isRefreshingOverview ? 'Memuat...' : 'Refresh Data'}</span>
            </button>
            <button
              type="button"
              onClick={onAdminLogout}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#FFEA00]/50 bg-[#FFEA00]/15 px-3 text-xs font-extrabold text-[#FFEA00] transition hover:bg-[#FFEA00]/25 active:scale-95"
            >
              <LogoutNeonIcon className="h-4 w-4" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>

      {/* Simplified 9-Item Navigation Menu — Easy to tap on Android Phone */}
      <div className="border-b border-white/10 bg-[#09090D] px-3 py-3 sm:px-5">
        <div className="mx-auto max-w-4xl">
          <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
            {navMenuItems.map((item) => {
              const IconComp = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-center text-[11px] font-extrabold transition sm:justify-start sm:px-3.5 sm:text-xs ${
                    isActive
                      ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A] shadow-[0_0_15px_rgba(255,234,0,0.3)]'
                      : 'border border-white/10 bg-[#111116] text-zinc-300 hover:border-[#FFEA00]/40 hover:text-white'
                  }`}
                >
                  <IconComp className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {typeof item.badge === 'number' && item.badge > 0 && (
                    <span
                      className={`ml-0.5 text-[10px] font-black ${
                        isActive ? 'text-[#08080A]' : 'text-[#FFEA00]'
                      }`}
                    >
                      ({item.badge})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-3.5 pt-4 sm:px-5">
        {/* Inline Action Feedback Banner */}
        {localFeedback && (
          <div
            className={`mb-4 flex items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-xs font-bold ${
              localFeedback.type === 'error'
                ? 'border-red-400/50 bg-red-500/15 text-red-200'
                : 'border-[#FFEA00]/50 bg-[#18160C] text-[#FFEA00]'
            }`}
          >
            <span>{localFeedback.message}</span>
            <button
              type="button"
              onClick={() => setLocalFeedback(null)}
              className="text-zinc-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* ====================================================================
            MENU 1: DASHBOARD ADMIN (RINGKASAN SEDERHANA & JELAS)
           ==================================================================== */}
        {activeTab === 'DASHBOARD' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold text-white">
                  Ringkasan Utama COINOVA
                </h2>
                <p className="text-xs text-zinc-400">
                  Pantau statistik pengguna, koin beredar, misi, dan penarikan saldo secara langsung.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  fetchServerOverview();
                  notifyAdmin('Ringkasan dashboard berhasil diperbarui.', 'success');
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#FFEA00]/40 bg-[#14130B] px-3 text-xs font-extrabold text-[#FFEA00] sm:hidden"
              >
                <span>Refresh Data</span>
              </button>
            </div>

            {/* 6 Summary Cards Required */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="coinova-card rounded-2xl p-4">
                <p className="text-xs font-bold text-zinc-400">Total Users</p>
                <p className="mt-1 font-mono-num text-2xl font-black text-white sm:text-3xl">
                  {totalUsersCount.toLocaleString('id-ID')}
                </p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Seluruh akun pemain terdaftar
                </p>
              </div>

              <div className="coinova-card rounded-2xl p-4">
                <p className="text-xs font-bold text-zinc-400">Users Aktif</p>
                <p className="mt-1 font-mono-num text-2xl font-black text-[#FFEA00] sm:text-3xl">
                  {activeUsersCount.toLocaleString('id-ID')}
                </p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Akun berstatus aktif bermain
                </p>
              </div>

              <div className="coinova-card rounded-2xl p-4">
                <p className="text-xs font-bold text-zinc-400">Total Transaksi</p>
                <p className="mt-1 font-mono-num text-2xl font-black text-white sm:text-3xl">
                  {totalTransactionsCount.toLocaleString('id-ID')}
                </p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Riwayat mutasi koin &amp; saldo
                </p>
              </div>

              <div className="coinova-card rounded-2xl p-4">
                <p className="text-xs font-bold text-zinc-400">Total Withdraw</p>
                <p className="mt-1 font-mono-num text-2xl font-black text-[#FFEA00] sm:text-3xl">
                  {totalWithdrawalsCount.toLocaleString('id-ID')}
                </p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {pendingWithdrawalsCount > 0
                    ? `${pendingWithdrawalsCount} permintaan menunggu proses`
                    : 'Semua penarikan telah diproses'}
                </p>
              </div>

              <div className="coinova-card rounded-2xl p-4">
                <p className="text-xs font-bold text-zinc-400">Total Coin Beredar</p>
                <p className="mt-1 font-mono-num text-2xl font-black text-[#FFEA00] sm:text-3xl">
                  {totalCoinsCirculating.toLocaleString('id-ID')}
                </p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Setara Rp {calculateIdrFromCoins(totalCoinsCirculating).toLocaleString('id-ID')}
                </p>
              </div>

              <div className="coinova-card rounded-2xl p-4">
                <p className="text-xs font-bold text-zinc-400">Misi Aktif</p>
                <p className="mt-1 font-mono-num text-2xl font-black text-white sm:text-3xl">
                  {activeTasksCount.toLocaleString('id-ID')}
                </p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  Dari total {tasks.length} misi tersedia
                </p>
              </div>
            </div>

            {/* Quick Action Navigation Cards */}
            <div className="coinova-card space-y-3 rounded-2xl p-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#FFEA00]">
                Akses Cepat Menu Admin
              </h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('FINANCE');
                    setFinanceSubTab('WITHDRAWALS');
                  }}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-[#101015] p-3.5 text-left transition hover:border-[#FFEA00]/50"
                >
                  <div>
                    <p className="text-xs font-extrabold text-white">
                      Proses Withdraw &amp; Order Level
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      {pendingWithdrawalsCount} withdraw pending · {pendingUpgradeOrdersCount} order level
                    </p>
                  </div>
                  <span className="rounded-lg bg-[#FFEA00] px-2.5 py-1 text-[11px] font-black text-[#08080A]">
                    Buka
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('USERS')}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-[#101015] p-3.5 text-left transition hover:border-[#FFEA00]/50"
                >
                  <div>
                    <p className="text-xs font-extrabold text-white">
                      Kelola Users &amp; Sesuaikan Saldo
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      Tambah/kurangi Coin, Diamond, atau suspend akun
                    </p>
                  </div>
                  <span className="rounded-lg border border-[#FFEA00]/50 bg-[#18160C] px-2.5 py-1 text-[11px] font-extrabold text-[#FFEA00]">
                    Buka
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('TASKS')}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-[#101015] p-3.5 text-left transition hover:border-[#FFEA00]/50"
                >
                  <div>
                    <p className="text-xs font-extrabold text-white">
                      Kelola Misi &amp; Hadiah
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      Buat misi baru, edit reward, atau nonaktifkan misi
                    </p>
                  </div>
                  <span className="rounded-lg border border-[#FFEA00]/50 bg-[#18160C] px-2.5 py-1 text-[11px] font-extrabold text-[#FFEA00]">
                    Buka
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('SETTINGS')}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-[#101015] p-3.5 text-left transition hover:border-[#FFEA00]/50"
                >
                  <div>
                    <p className="text-xs font-extrabold text-white">
                      Pengaturan Ekonomi COINOVA
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      Atur minimal withdraw, reward tap, dan bonus referral
                    </p>
                  </div>
                  <span className="rounded-lg border border-[#FFEA00]/50 bg-[#18160C] px-2.5 py-1 text-[11px] font-extrabold text-[#FFEA00]">
                    Buka
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            MENU 7: TRANSAKSI / WITHDRAW (WITHDRAW, ORDER LEVEL, REFERRAL, TRANSAKSI)
           ==================================================================== */}
        {activeTab === 'FINANCE' && (
          <div className="space-y-4">
            {/* Sub-tab Selector */}
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#0C0C10] p-1.5 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setFinanceSubTab('WITHDRAWALS')}
                className={`min-h-[40px] rounded-xl px-3 py-2 text-xs font-extrabold transition ${
                  financeSubTab === 'WITHDRAWALS'
                    ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A]'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Withdraw ({mergedWithdrawals.length})
              </button>
              <button
                type="button"
                onClick={() => setFinanceSubTab('UPGRADE_ORDERS')}
                className={`min-h-[40px] rounded-xl px-3 py-2 text-xs font-extrabold transition ${
                  financeSubTab === 'UPGRADE_ORDERS'
                    ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A]'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Order Level ({mergedUpgradeOrders.length})
              </button>
              <button
                type="button"
                onClick={() => setFinanceSubTab('REFERRALS')}
                className={`min-h-[40px] rounded-xl px-3 py-2 text-xs font-extrabold transition ${
                  financeSubTab === 'REFERRALS'
                    ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A]'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Referral ({mergedReferrals.length})
              </button>
              <button
                type="button"
                onClick={() => setFinanceSubTab('TRANSACTIONS')}
                className={`min-h-[40px] rounded-xl px-3 py-2 text-xs font-extrabold transition ${
                  financeSubTab === 'TRANSACTIONS'
                    ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A]'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                Riwayat ({mergedTransactions.length})
              </button>
            </div>

            {/* SUB-TAB A: WITHDRAWALS */}
            {financeSubTab === 'WITHDRAWALS' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-extrabold text-white">
                      Permintaan Penarikan Saldo E-Wallet
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Verifikasi dan proses pencairan dana pemain ke DANA, GoPay, OVO, atau ShopeePay.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportWithdrawalsCsv}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#FFEA00]/45 bg-[#18160C] px-3 text-xs font-extrabold text-[#FFEA00] transition hover:bg-[#FFEA00]/20"
                  >
                    <ExportCsvNeonIcon className="h-4 w-4" />
                    <span>Export CSV</span>
                  </button>
                </div>

                {/* Filter Status Withdraw */}
                <div className="flex flex-wrap gap-1.5">
                  {(['ALL', 'PENDING', 'PROCESSING', 'PAID', 'REJECTED'] as const).map(
                    (st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setWithdrawStatusFilter(st)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                          withdrawStatusFilter === st
                            ? 'bg-[#FFEA00] text-[#08080A]'
                            : 'border border-white/10 bg-[#101015] text-zinc-300 hover:text-white'
                        }`}
                      >
                        {st === 'ALL' ? 'Semua Status' : st}
                      </button>
                    )
                  )}
                </div>

                {filteredWithdrawals.length === 0 ? (
                  <div className="coinova-card rounded-2xl p-8 text-center text-xs text-zinc-400">
                    Belum ada permintaan penarikan saldo pada filter ini.
                  </div>
                ) : (
                  filteredWithdrawals.map((w) => {
                    const isSelected = selectedWithdrawId === w.withdrawalId;
                    const lockedCoins =
                      w.coinDeducted || calculateCoinsFromIdr(w.amount);
                    const lockedFire =
                      w.fireDeducted || calculateRequiredFireForWithdrawal(w.amount);

                    return (
                      <div
                        key={w.withdrawalId}
                        className="coinova-card space-y-3 rounded-2xl p-4 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <EWalletBrandBadge method={w.method} className="h-10 w-10" />
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono-num text-sm font-extrabold text-[#FFEA00]">
                                  Rp {w.amount.toLocaleString('id-ID')}
                                </span>
                                {w.isVipPriority && (
                                  <span className="inline-flex items-center gap-1 rounded-md border border-[#FFEA00]/60 bg-[#FFEA00]/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#FFEA00]">
                                    👑 PRIORITAS VIP
                                  </span>
                                )}
                                <span className="text-[11px] font-extrabold text-zinc-300">
                                  · Status: {w.status}
                                </span>
                              </div>
                              <p className="mt-0.5 text-zinc-200">
                                {w.method} · <strong>{w.accountNumber}</strong> a/n{' '}
                                <strong>{w.accountName}</strong> ({w.username})
                              </p>
                              <p className="mt-0.5 font-mono-num text-[11px] text-zinc-400">
                                Saldo Dikunci: {lockedCoins.toLocaleString('id-ID')} Coin +{' '}
                                {lockedFire} Diamond · Waktu:{' '}
                                {w.createdAt
                                  ? new Date(w.createdAt).toLocaleString('id-ID')
                                  : '-'}
                              </p>
                            </div>
                          </div>

                          {(w.status === 'PENDING' || w.status === 'PROCESSING') && (
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedWithdrawId(isSelected ? null : w.withdrawalId)
                              }
                              className="h-9 rounded-xl border border-[#FFEA00]/50 bg-[#18160C] px-3.5 font-extrabold text-[#FFEA00] transition hover:bg-[#FFEA00]/20"
                            >
                              {isSelected ? 'Tutup Panel' : 'Proses Withdraw'}
                            </button>
                          )}
                        </div>

                        {isSelected && (
                          <div className="space-y-3 rounded-xl border border-[#FFEA00]/30 bg-[#0A0A0E] p-3.5">
                            <div>
                              <label className="mb-1 block text-xs font-bold text-zinc-200">
                                Nomor Referensi Transfer (Opsional)
                              </label>
                              <input
                                type="text"
                                value={paymentRef}
                                onChange={(e) => setPaymentRef(e.target.value)}
                                placeholder="Contoh: REF-DANA-20260928"
                                className="h-10 w-full rounded-xl border border-white/15 bg-[#060608] px-3 text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                              />
                              <p className="mt-1 text-[11px] text-zinc-400">
                                Kode bukti transfer E-Wallet untuk dicatat pada riwayat penarikan pemain.
                              </p>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-bold text-zinc-200">
                                Catatan Admin untuk Pemain
                              </label>
                              <input
                                type="text"
                                value={adminNote}
                                onChange={(e) => setAdminNote(e.target.value)}
                                placeholder="Contoh: Dana telah dikirim ke akun E-Wallet Anda"
                                className="h-10 w-full rounded-xl border border-white/15 bg-[#060608] px-3 text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={busyAction === `wd_${w.withdrawalId}`}
                                onClick={async () => {
                                  await onProcessWithdrawal(
                                    w,
                                    'PROCESSING',
                                    paymentRef,
                                    adminNote || 'Sedang dalam proses pencairan manual'
                                  );
                                  setSelectedWithdrawId(null);
                                  void fetchServerOverview();
                                  notifyAdmin(
                                    `Withdraw ${w.username} diubah menjadi PROCESSING.`,
                                    'success'
                                  );
                                }}
                                className="h-10 rounded-xl border border-white/20 bg-[#14141A] px-3.5 font-bold text-white transition hover:border-[#FFEA00]"
                              >
                                Set PROCESSING
                              </button>
                              <button
                                type="button"
                                disabled={busyAction === `wd_${w.withdrawalId}`}
                                onClick={async () => {
                                  await onProcessWithdrawal(
                                    w,
                                    'PAID',
                                    paymentRef || `REF-${Date.now()}`,
                                    adminNote || 'Dana berhasil dikirim ke E-Wallet'
                                  );
                                  setSelectedWithdrawId(null);
                                  void fetchServerOverview();
                                  notifyAdmin(
                                    `Withdraw Rp${w.amount.toLocaleString('id-ID')} (${w.username}) berhasil disetujui (PAID).`,
                                    'success'
                                  );
                                }}
                                className="h-10 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-4 font-black text-[#08080A]"
                              >
                                Approve (PAID / CAIR)
                              </button>
                              <button
                                type="button"
                                disabled={busyAction === `wd_${w.withdrawalId}`}
                                onClick={async () => {
                                  await onProcessWithdrawal(
                                    w,
                                    'REJECTED',
                                    '',
                                    adminNote ||
                                      'Nomor E-Wallet tidak valid, Coin & Diamond dikembalikan ke dompet'
                                  );
                                  setSelectedWithdrawId(null);
                                  void fetchServerOverview();
                                  notifyAdmin(
                                    `Withdraw ${w.username} ditolak & saldo dikembalikan.`,
                                    'success'
                                  );
                                }}
                                className="h-10 rounded-xl border border-red-400/50 bg-red-500/15 px-3.5 font-bold text-red-200"
                              >
                                Reject &amp; Refund Saldo
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* SUB-TAB B: LEVEL UPGRADE ORDERS */}
            {financeSubTab === 'UPGRADE_ORDERS' && (
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-extrabold text-white">
                    Verifikasi Pembayaran &amp; Order Upgrade Level (QRIS / Rupiah)
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Periksa bukti screenshot pembayaran sebelum menyetujui (APPROVE) atau menolak (REJECT).
                  </p>
                </div>

                {mergedUpgradeOrders.length === 0 ? (
                  <div className="coinova-card rounded-2xl p-8 text-center text-xs text-zinc-400">
                    Belum ada order pembelian upgrade level.
                  </div>
                ) : (
                  mergedUpgradeOrders.map((ord) => {
                    const isSelected = selectedOrderId === ord.orderId;
                    const statusBadgeLabel =
                      ord.status === 'PAID'
                        ? 'APPROVED'
                        : ord.status === 'PENDING_VERIFICATION'
                        ? 'MENUNGGU VERIFIKASI'
                        : ord.status === 'WAITING_PAYMENT'
                        ? 'MENUNGGU PEMBAYARAN'
                        : 'REJECTED';

                    return (
                      <div
                        key={ord.orderId}
                        className="coinova-card space-y-3 rounded-2xl p-4 text-xs"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <EWalletBrandBadge
                              method={ord.paymentMethod}
                              className="mt-0.5 h-10 w-10"
                            />
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-extrabold text-white">
                                  {ord.username} → Lv.{ord.targetLevel} ({ord.levelName})
                                </span>
                                <span className="text-[11px] font-extrabold text-[#FFEA00]">
                                  · {statusBadgeLabel}
                                </span>
                              </div>

                              <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 pt-1 text-[11px] text-zinc-300 sm:grid-cols-2">
                                <p>
                                  <span className="text-zinc-400">Order ID:</span>{' '}
                                  <span className="font-mono-num font-bold text-white">
                                    {ord.orderId}
                                  </span>
                                </p>
                                <p>
                                  <span className="text-zinc-400">User UID:</span>{' '}
                                  <span className="font-mono-num text-zinc-200">
                                    {ord.uid}
                                  </span>
                                </p>
                                <p>
                                  <span className="text-zinc-400">Nominal:</span>{' '}
                                  <span className="font-mono-num font-extrabold text-[#FFEA00]">
                                    Rp {ord.priceIdr.toLocaleString('id-ID')}
                                  </span>
                                </p>
                                <p>
                                  <span className="text-zinc-400">Metode:</span>{' '}
                                  <span className="font-bold text-white">
                                    {ord.paymentMethod}
                                  </span>
                                </p>
                                <p>
                                  <span className="text-zinc-400">Referensi:</span>{' '}
                                  <span className="font-mono-num font-bold text-white">
                                    {ord.paymentReference || '-'}
                                  </span>
                                </p>
                                <p>
                                  <span className="text-zinc-400">Waktu:</span>{' '}
                                  <span>
                                    {new Date(
                                      ord.paidSubmittedAt || ord.createdAt
                                    ).toLocaleString('id-ID')}
                                  </span>
                                </p>
                              </div>

                              {ord.adminNote && (
                                <p className="pt-0.5 text-[11px] text-zinc-300">
                                  Catatan: {ord.adminNote}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {(ord.paymentProofDataUrl || ord.paymentProofImage) && (
                              <button
                                type="button"
                                onClick={() => setPreviewProofOrder(ord)}
                                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/20 bg-[#14141A] px-3 font-extrabold text-white hover:border-[#FFEA00]"
                              >
                                <EyeNeonIcon className="h-4 w-4 text-[#FFEA00]" />
                                <span>Lihat Bukti Bayar</span>
                              </button>
                            )}

                            {ord.status !== 'PAID' && ord.status !== 'REJECTED' && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedOrderId(isSelected ? null : ord.orderId)
                                }
                                className="h-9 rounded-xl border border-[#FFEA00]/50 bg-[#18160C] px-3.5 font-extrabold text-[#FFEA00]"
                              >
                                {isSelected ? 'Tutup Panel' : 'Proses Order'}
                              </button>
                            )}
                          </div>
                        </div>

                        {(ord.paymentProofDataUrl || ord.paymentProofImage) && (
                          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0A0A0E] p-2.5">
                            <img
                              src={ord.paymentProofDataUrl || ord.paymentProofImage}
                              alt={`Bukti ${ord.orderId}`}
                              onClick={() => setPreviewProofOrder(ord)}
                              className="h-16 w-16 cursor-pointer rounded-lg border border-[#FFEA00]/40 object-cover"
                            />
                            <div className="min-w-0 flex-1 text-[11px]">
                              <p className="font-extrabold text-[#FFEA00]">
                                Bukti Screenshot Pembayaran Terlampir
                              </p>
                              <p className="truncate text-zinc-400">
                                File: {ord.paymentProofFileName || 'bukti_qris.jpg'}
                              </p>
                              <button
                                type="button"
                                onClick={() => setPreviewProofOrder(ord)}
                                className="mt-1 text-[11px] font-bold text-white underline"
                              >
                                Perbesar Gambar Bukti Transfer
                              </button>
                            </div>
                          </div>
                        )}

                        {isSelected && (
                          <div className="space-y-3 rounded-xl border border-[#FFEA00]/30 bg-[#0A0A0E] p-3.5">
                            <div>
                              <label className="mb-1 block text-xs font-bold text-zinc-200">
                                Catatan Verifikasi Admin (Opsional)
                              </label>
                              <input
                                type="text"
                                value={orderAdminNote}
                                onChange={(e) => setOrderAdminNote(e.target.value)}
                                placeholder="Masukkan catatan persetujuan atau alasan penolakan..."
                                className="h-10 w-full rounded-xl border border-white/15 bg-[#060608] px-3 text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={busyAction === `ord_${ord.orderId}`}
                                onClick={async () => {
                                  await onReviewUpgradeOrder(
                                    ord,
                                    'PAID',
                                    orderAdminNote ||
                                      `Pembayaran QRIS Rp${ord.priceIdr.toLocaleString('id-ID')} disetujui Admin. Level ${ord.targetLevel} (${ord.levelName}) diaktifkan.`
                                  );
                                  setSelectedOrderId(null);
                                  setOrderAdminNote('');
                                  void fetchServerOverview();
                                  notifyAdmin(
                                    `Order Level ${ord.targetLevel} untuk ${ord.username} disetujui!`,
                                    'success'
                                  );
                                }}
                                className="h-10 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-4 font-black text-[#08080A]"
                              >
                                APPROVE &amp; Aktifkan Level {ord.targetLevel}
                              </button>
                              <button
                                type="button"
                                disabled={busyAction === `ord_${ord.orderId}`}
                                onClick={async () => {
                                  await onReviewUpgradeOrder(
                                    ord,
                                    'REJECTED',
                                    orderAdminNote ||
                                      'Bukti pembayaran tidak valid / dana belum diterima. Level tidak berubah.'
                                  );
                                  setSelectedOrderId(null);
                                  setOrderAdminNote('');
                                  void fetchServerOverview();
                                  notifyAdmin(
                                    `Order upgrade level ${ord.username} telah ditolak.`,
                                    'success'
                                  );
                                }}
                                className="h-10 rounded-xl border border-red-400/50 bg-red-500/15 px-3.5 font-bold text-red-200"
                              >
                                REJECT (Tolak Order)
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* SUB-TAB C: REFERRAL MILESTONES */}
            {financeSubTab === 'REFERRALS' && (
              <div className="space-y-3">
                <div>
                  <h2 className="text-sm font-extrabold text-white">
                    Verifikasi Komisi &amp; Milestone Referral
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Set Aktif (+2 Diamond ke Pengundang) · Approve Top-Up (+25.000 Coin) · Reward Upgrade (+25.000 Coin &amp; +10 Diamond).
                  </p>
                </div>

                {mergedReferrals.length === 0 ? (
                  <div className="coinova-card rounded-2xl p-8 text-center text-xs text-zinc-400">
                    Belum ada data jaringan referral pemain.
                  </div>
                ) : (
                  mergedReferrals.map((ref) => {
                    const isVerified =
                      ref.status === 'VERIFIED' || Boolean(ref.topupRewardClaimed);
                    const isActive =
                      ref.status === 'ACTIVE' || Boolean(ref.activeRewardClaimed);
                    return (
                      <div
                        key={ref.referralId}
                        className="coinova-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-extrabold text-white">
                              Teman Diundang: {ref.inviteeUsername} ({ref.inviteeUid})
                            </span>
                            <span className="text-[11px] font-bold text-[#FFEA00]">
                              · Status: {ref.status}
                            </span>
                          </div>
                          <p className="font-mono-num flex flex-wrap items-center gap-1 text-[11px] text-zinc-300">
                            <span>Pengundang UID: {ref.inviterUid} · Milestone Aktif:</span>
                            {isActive ? (
                              <span className="inline-flex items-center gap-1 text-[#FFEA00]">
                                ✓ Sudah (+2 <DiamondIcon className="h-3 w-3 shrink-0" />)
                              </span>
                            ) : (
                              <span>Belum</span>
                            )}
                            <span>· Milestone Top-Up / Upgrade:</span>
                            <span>{isVerified ? '✓ Sudah (+25.000 Coin)' : 'Belum'}</span>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {!isActive && ref.status !== 'REJECTED' && (
                            <button
                              type="button"
                              disabled={busyAction === `ver_${ref.referralId}`}
                              onClick={async () => {
                                await onProcessReferral?.(ref, 'ACTIVE');
                                void fetchServerOverview();
                                notifyAdmin(
                                  `Milestone Aktif untuk ${ref.inviteeUsername} berhasil disetujui.`,
                                  'success'
                                );
                              }}
                              className="inline-flex h-9 items-center gap-1 rounded-xl border border-white/20 bg-[#14141A] px-3 text-[11px] font-extrabold text-white hover:border-[#FFEA00]"
                            >
                              <span>Set Aktif (+2</span>
                              <DiamondIcon className="h-3 w-3 shrink-0" />
                              <span>)</span>
                            </button>
                          )}
                          {!isVerified && ref.status !== 'REJECTED' && (
                            <button
                              type="button"
                              disabled={busyAction === `ver_${ref.referralId}`}
                              onClick={async () => {
                                await onProcessReferral?.(ref, 'VERIFIED');
                                void fetchServerOverview();
                                notifyAdmin(
                                  `Bonus Top-Up Referral (${ref.inviteeUsername}) berhasil diberikan.`,
                                  'success'
                                );
                              }}
                              className="h-9 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-3 text-[11px] font-black text-[#08080A]"
                            >
                              Approve Top-Up (+25.000 Coin)
                            </button>
                          )}
                          {!isVerified && ref.status !== 'REJECTED' && (
                            <button
                              type="button"
                              disabled={busyAction === `ver_${ref.referralId}`}
                              onClick={async () => {
                                await onProcessReferral?.(ref, 'UPGRADE');
                                void fetchServerOverview();
                                notifyAdmin(
                                  `Reward Upgrade Referral (${ref.inviteeUsername}) berhasil diberikan.`,
                                  'success'
                                );
                              }}
                              className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#FFEA00]/50 bg-[#18160C] px-3 text-[11px] font-extrabold text-[#FFEA00]"
                            >
                              <span>Reward Upgrade (+25.000 Coin &amp; +10</span>
                              <DiamondIcon className="h-3 w-3 shrink-0" />
                              <span>)</span>
                            </button>
                          )}
                          {ref.status !== 'VERIFIED' && ref.status !== 'REJECTED' && (
                            <button
                              type="button"
                              disabled={busyAction === `ver_${ref.referralId}`}
                              onClick={async () => {
                                await onProcessReferral?.(ref, 'REJECTED');
                                void fetchServerOverview();
                                notifyAdmin(
                                  `Referral ${ref.inviteeUsername} ditolak.`,
                                  'success'
                                );
                              }}
                              className="h-9 rounded-xl border border-red-400/50 bg-red-500/15 px-3 text-[11px] font-bold text-red-300"
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* SUB-TAB D: TRANSACTIONS LEDGER */}
            {financeSubTab === 'TRANSACTIONS' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-extrabold text-white">
                      Riwayat Transaksi Sistem ({filteredTransactions.length})
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Catatan lengkap mutasi koin, diamond, hadiah misi, dan penarikan saldo.
                    </p>
                  </div>
                  <input
                    type="text"
                    value={txSearchQuery}
                    onChange={(e) => setTxSearchQuery(e.target.value)}
                    placeholder="Cari UID / keterangan transaksi..."
                    className="h-9 w-full rounded-xl border border-white/15 bg-[#0C0C10] px-3 text-xs text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none sm:w-64"
                  />
                </div>

                {filteredTransactions.length === 0 ? (
                  <div className="coinova-card rounded-2xl p-8 text-center text-xs text-zinc-400">
                    Belum ada catatan transaksi yang sesuai pencarian.
                  </div>
                ) : (
                  filteredTransactions.map((tx) => {
                    const isCredit =
                      tx.direction === 'CREDIT' || tx.direction === 'REFUND';
                    return (
                      <div
                        key={tx.id}
                        className="coinova-card flex items-center justify-between gap-3 rounded-2xl p-3.5 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                            <span className="font-extrabold text-[#FFEA00]">
                              {tx.category}
                            </span>
                            <span>·</span>
                            <span className="font-mono-num">UID: {tx.uid}</span>
                            {tx.createdAt && (
                              <>
                                <span>·</span>
                                <span>
                                  {new Date(tx.createdAt).toLocaleString('id-ID')}
                                </span>
                              </>
                            )}
                          </div>
                          <p className="mt-1 font-bold text-white">{tx.description}</p>
                        </div>
                        <div className="shrink-0 text-right font-mono-num font-extrabold">
                          <span
                            className={isCredit ? 'text-[#FFEA00]' : 'text-zinc-300'}
                          >
                            {isCredit ? '+' : '-'}
                            {tx.currency === 'IDR'
                              ? `Rp${tx.amount.toLocaleString('id-ID')}`
                              : `${tx.amount.toLocaleString('id-ID')} ${
                                  tx.currency === 'FIRE' ? 'Diamond' : 'Coin'
                                }`}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {/* ====================================================================
            MENU 2: USERS (USER SEARCH, FILTER, BALANCE ADJUST, SUSPEND/ACTIVATE)
           ==================================================================== */}
        {activeTab === 'USERS' && (
          <div className="space-y-4">
            <div className="coinova-card space-y-3.5 rounded-2xl p-4">
              <div>
                <h2 className="text-sm font-extrabold text-white">
                  Penyesuaian Saldo Pemain (Coin / Diamond / Rupiah)
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Perubahan saldo Coin dan Rupiah disinkronkan secara otomatis (10 Coin = Rp 1). Gunakan angka positif untuk menambah atau negatif (-) untuk mengurangi.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Pilih Pemain
                  </label>
                  <select
                    value={adjustUid}
                    onChange={(e) => setAdjustUid(e.target.value)}
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                  >
                    <option value="">-- Pilih Akun Pemain --</option>
                    {mergedUsers.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.username} (Lv.{u.dragonLevel} · UID: {u.uid})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Pilih akun pemain yang ingin ditambah atau dikurangi saldonya.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Jenis Mata Uang
                  </label>
                  <select
                    value={adjustCurrency}
                    onChange={(e) => setAdjustCurrency(e.target.value as CurrencyType)}
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                  >
                    <option value="COIN">Coin COINOVA (Sinkron Saldo Rupiah)</option>
                    <option value="FIRE">Diamond (Permata Langka)</option>
                    <option value="IDR">Saldo Rupiah IDR (Sinkron Coin)</option>
                  </select>
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Satuan: {adjustCurrency === 'IDR' ? 'Rupiah (Rp)' : adjustCurrency === 'FIRE' ? 'Diamond' : 'Coin'}
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Nominal Perubahan (+/-)
                  </label>
                  <input
                    type="number"
                    value={adjustDelta}
                    onChange={(e) => setAdjustDelta(e.target.value)}
                    placeholder="Contoh: 10000 atau -5000"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs font-bold text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Masukkan angka positif (+) untuk menambah atau negatif (-) untuk mengurangi.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Alasan / Catatan Penyesuaian
                  </label>
                  <input
                    type="text"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="Contoh: Bonus event / kompensasi misi"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Catatan ini akan tersimpan di riwayat transaksi pemain dan Audit Log.
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={
                  !adjustUid ||
                  !Number(adjustDelta) ||
                  busyAction === `bal_${adjustUid}`
                }
                onClick={async () => {
                  const deltaNum = Number(adjustDelta);
                  if (!adjustUid || !deltaNum) return;
                  await onAdjustUserBalance(
                    adjustUid,
                    adjustCurrency,
                    deltaNum,
                    adjustReason.trim() || 'Penyesuaian Saldo oleh Admin'
                  );
                  setAdjustDelta('');
                  void fetchServerOverview();
                  notifyAdmin('Saldo pemain berhasil diperbarui!', 'success');
                }}
                className="h-11 w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(250,204,21,0.28)] disabled:opacity-40"
              >
                Simpan &amp; Terapkan Saldo Pemain
              </button>
            </div>

            {/* FILTER & SEARCH USERS */}
            <div className="coinova-card space-y-3 rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-white">
                    Daftar Pemain Terdaftar ({filteredUsers.length})
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Kelola status aktif/suspend dan pantau saldo setiap pemain.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'ALL', label: 'Semua' },
                      { id: 'active', label: 'Aktif' },
                      { id: 'suspended', label: 'Suspended' },
                    ] as const
                  ).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setUserStatusFilter(st.id)}
                      className={`h-8 rounded-xl px-3 text-xs font-bold ${
                        userStatusFilter === st.id
                          ? 'bg-[#FFEA00] text-[#08080A]'
                          : 'border border-white/15 bg-[#121218] text-zinc-300'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              <input
                type="text"
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                placeholder="Cari username, UID, atau kode referral..."
                className="h-10 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
              />
            </div>

            <div className="space-y-2.5">
              {filteredUsers.length === 0 ? (
                <div className="coinova-card rounded-2xl p-8 text-center text-xs text-zinc-400">
                  Tidak ada pemain yang cocok dengan pencarian.
                </div>
              ) : (
                filteredUsers.map((u) => {
                  const w = mergedWallets.find((item) => item.uid === u.uid);
                  const coins = w?.coinBalance || 0;
                  const syncedIdr = calculateIdrFromCoins(coins, settings.coinToIdrRate);
                  const diamonds = w?.fireBalance || 0;
                  return (
                    <div
                      key={u.uid}
                      className="coinova-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-extrabold text-white">
                            {u.username}
                          </span>
                          <span className="text-xs font-bold text-[#FFEA00]">
                            Lv.{u.dragonLevel}
                          </span>
                          <span
                            className={`text-[11px] font-bold ${
                              u.status === 'active' ? 'text-zinc-300' : 'text-red-400'
                            }`}
                          >
                            · {u.status === 'active' ? 'Aktif' : 'Suspended'}
                          </span>
                        </div>
                        <p className="font-mono-num text-[11px] text-zinc-400">
                          UID: {u.uid} · Kode Referral: {u.referralCode}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 font-mono-num text-xs text-zinc-200">
                          <span>
                            Coin:{' '}
                            <strong className="text-[#FFEA00]">
                              {coins.toLocaleString('id-ID')}
                            </strong>
                          </span>
                          <span>
                            Saldo IDR:{' '}
                            <strong className="text-white">
                              Rp {syncedIdr.toLocaleString('id-ID')}
                            </strong>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span>Diamond:</span>
                            <strong className="text-[#FFEA00]">
                              {diamonds.toLocaleString('id-ID')}
                            </strong>
                            <DiamondIcon className="h-3.5 w-3.5 shrink-0" />
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setAdjustUid(u.uid);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="h-9 rounded-xl border border-white/20 bg-[#14141A] px-3 text-xs font-bold text-white hover:border-[#FFEA00]"
                        >
                          Atur Saldo
                        </button>
                        <button
                          type="button"
                          disabled={busyAction === `sus_${u.uid}`}
                          onClick={async () => {
                            const nextStatus =
                              u.status === 'active' ? 'suspended' : 'active';
                            setSuspendedUidOverrides((prev) => ({
                              ...prev,
                              [u.uid]: nextStatus,
                            }));
                            await onToggleUserSuspend(u.uid, u.status);
                            void fetchServerOverview();
                            notifyAdmin(
                              u.status === 'active'
                                ? `Akun ${u.username} telah di-suspend.`
                                : `Akun ${u.username} diaktifkan kembali.`,
                              'success'
                            );
                          }}
                          className={`h-9 rounded-xl px-3.5 text-xs font-extrabold ${
                            u.status === 'active'
                              ? 'border border-red-400/50 bg-red-500/15 text-red-200 hover:bg-red-500/25'
                              : 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A]'
                          }`}
                        >
                          {u.status === 'active' ? 'Suspend User' : 'Aktifkan User'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ====================================================================
            MENU VIP: ADMIN VIP (PEMBAYARAN VIP, APPROVE/REJECT, DAFTAR VIP AKTIF/EXPIRED)
           ==================================================================== */}
        {activeTab === 'VIP' && (
          <div className="space-y-4">
            {/* Section 1: Pembayaran VIP & Tombol Approve / Reject */}
            <div className="coinova-card space-y-3.5 rounded-2xl border border-[#FFEA00]/35 p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                <div>
                  <h2 className="text-sm font-extrabold uppercase tracking-wider text-[#FFEA00]">
                    👑 Verifikasi Pembayaran COINOVA VIP (Rp 100.000 / 30 Hari)
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    VIP hanya aktif setelah pembayaran diverifikasi Admin. Saat di-Approve, user mendapatkan status VIP Active selama 30 hari + Bonus Bulanan +50 Diamond.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchAdminVipAndPromoAndBroadcasts()}
                  className="h-8 rounded-xl border border-[#FFEA00]/40 bg-[#18160C] px-3 text-[11px] font-extrabold text-[#FFEA00]"
                >
                  {isLoadingVipData ? 'Memuat...' : 'Refresh Data VIP'}
                </button>
              </div>

              {vipOrders.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-[#08080C] p-6 text-center text-xs text-zinc-400">
                  Belum ada pengajuan pembayaran COINOVA VIP dari pemain.
                </div>
              ) : (
                <div className="space-y-3">
                  {vipOrders.map((ord) => {
                    const isPending = ord.status === 'PENDING_VERIFICATION';
                    return (
                      <div
                        key={ord.orderId}
                        className="rounded-2xl border border-white/15 bg-[#08080C] p-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-extrabold text-white">
                                {ord.username}
                              </span>
                              <span className="font-mono-num text-xs font-black text-[#FFEA00]">
                                Rp {Number(ord.priceIdr || 100000).toLocaleString('id-ID')} ({ord.durationDays || 30} Hari)
                              </span>
                              <span
                                className={`rounded-md border px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                                  ord.status === 'APPROVED'
                                    ? 'border-[#FFEA00]/60 bg-[#FFEA00]/15 text-[#FFEA00]'
                                    : ord.status === 'REJECTED'
                                    ? 'border-red-500/40 bg-red-500/15 text-red-300'
                                    : 'border-amber-400/50 bg-amber-400/15 text-amber-200'
                                }`}
                              >
                                {ord.status === 'APPROVED'
                                  ? 'APPROVED (VIP AKTIF)'
                                  : ord.status === 'REJECTED'
                                  ? 'REJECTED (DITOLAK)'
                                  : 'MENUNGGU VERIFIKASI'}
                              </span>
                            </div>
                            <p className="font-mono-num text-[11px] text-zinc-400">
                              Order ID: {ord.orderId} · UID: {ord.uid} · Metode: {ord.paymentMethod || 'QRIS'}
                            </p>
                            <p className="text-[11px] text-zinc-300">
                              Catatan/Ref User: <strong>{ord.paymentReference || '-'}</strong> · Waktu:{' '}
                              {new Date(ord.createdAt).toLocaleString('id-ID')}
                            </p>
                            {ord.vipExpiresAt && (
                              <p className="text-[11px] font-bold text-[#FFEA00]">
                                Berlaku s/d: {new Date(ord.vipExpiresAt).toLocaleString('id-ID')}
                              </p>
                            )}
                            {ord.adminNote && (
                              <p className="text-[11px] text-zinc-400">
                                Catatan Admin: {ord.adminNote}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {ord.paymentProofDataUrl && (
                              <button
                                type="button"
                                onClick={() => setPreviewVipProofOrder(ord)}
                                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/20 bg-[#14141A] px-3 text-xs font-extrabold text-white hover:border-[#FFEA00]"
                              >
                                <EyeNeonIcon className="h-4 w-4 text-[#FFEA00]" />
                                <span>Lihat Bukti Bayar</span>
                              </button>
                            )}

                            {isPending && (
                              <>
                                <button
                                  type="button"
                                  disabled={vipBusyOrderId === ord.orderId}
                                  onClick={() => void handleVerifyVipOrder(ord.orderId, 'APPROVED')}
                                  className="h-9 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-3.5 text-xs font-black text-[#08080A] shadow-[0_0_14px_rgba(255,234,0,0.3)] disabled:opacity-50"
                                >
                                  Approve VIP
                                </button>
                                <button
                                  type="button"
                                  disabled={vipBusyOrderId === ord.orderId}
                                  onClick={() => void handleVerifyVipOrder(ord.orderId, 'REJECTED')}
                                  className="h-9 rounded-xl border border-red-400/50 bg-red-500/15 px-3 text-xs font-extrabold text-red-200 hover:bg-red-500/25 disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {ord.paymentProofDataUrl && (
                          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0C0C12] p-2.5">
                            <img
                              src={ord.paymentProofDataUrl}
                              alt={`Bukti VIP ${ord.orderId}`}
                              onClick={() => setPreviewVipProofOrder(ord)}
                              className="h-14 w-14 cursor-pointer rounded-lg border border-[#FFEA00]/40 object-cover"
                            />
                            <div className="min-w-0 flex-1 text-[11px]">
                              <p className="font-extrabold text-[#FFEA00]">
                                Screenshot Bukti Pembayaran VIP
                              </p>
                              <p className="truncate text-zinc-400">
                                {ord.paymentProofFileName || 'bukti_vip.png'} — Klik untuk memperbesar
                              </p>
                            </div>
                          </div>
                        )}

                        {isPending && (
                          <div>
                            <input
                              type="text"
                              value={vipNoteInputMap[ord.orderId] || ''}
                              onChange={(e) =>
                                setVipNoteInputMap((prev) => ({
                                  ...prev,
                                  [ord.orderId]: e.target.value,
                                }))
                              }
                              placeholder="Catatan Admin (opsional) sebelum Approve / Reject..."
                              className="h-9 w-full rounded-xl border border-white/15 bg-[#0C0C12] px-3 text-xs text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section 2: Daftar Member VIP Aktif & Expired */}
            <div className="coinova-card space-y-3.5 rounded-2xl p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-white">
                    Daftar Member VIP Aktif &amp; Expired ({vipMembers.length})
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Pantau status masa aktif VIP (Active / Expired) dan tanggal berakhir setiap member.
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {(['ALL', 'ACTIVE', 'EXPIRED'] as const).map((flt) => (
                    <button
                      key={flt}
                      type="button"
                      onClick={() => setVipMemberFilter(flt)}
                      className={`h-8 rounded-xl px-3 text-xs font-extrabold ${
                        vipMemberFilter === flt
                          ? 'bg-[#FFEA00] text-[#08080A]'
                          : 'border border-white/15 bg-[#121218] text-zinc-300'
                      }`}
                    >
                      {flt === 'ALL' ? 'Semua' : flt}
                    </button>
                  ))}
                </div>
              </div>

              {vipMembers.filter((m) =>
                vipMemberFilter === 'ALL' ? true : m.vipStatus === vipMemberFilter
              ).length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-[#08080C] p-6 text-center text-xs text-zinc-400">
                  Belum ada data member VIP pada filter ini.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {vipMembers
                    .filter((m) =>
                      vipMemberFilter === 'ALL' ? true : m.vipStatus === vipMemberFilter
                    )
                    .map((m) => (
                      <div
                        key={m.uid}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#08080C] p-3.5"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-extrabold text-white">
                              👑 {m.username}
                            </span>
                            <span className="text-xs font-bold text-[#FFEA00]">
                              Lv.{m.dragonLevel}
                            </span>
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[10px] font-black uppercase ${
                                m.vipStatus === 'ACTIVE'
                                  ? 'border-[#FFEA00]/60 bg-[#FFEA00]/20 text-[#FFEA00]'
                                  : m.vipStatus === 'EXPIRED'
                                  ? 'border-red-500/40 bg-red-500/15 text-red-300'
                                  : 'border-amber-400/50 bg-amber-400/15 text-amber-200'
                              }`}
                            >
                              {m.vipStatus === 'ACTIVE'
                                ? 'ACTIVE'
                                : m.vipStatus === 'EXPIRED'
                                ? 'EXPIRED'
                                : m.vipStatus}
                            </span>
                          </div>
                          <p className="font-mono-num text-[11px] text-zinc-400">
                            UID: {m.uid}
                          </p>
                        </div>
                        <div className="text-right font-mono-num text-[11px]">
                          <p className="text-zinc-300">
                            Mulai:{' '}
                            {m.vipStartedAt
                              ? new Date(m.vipStartedAt).toLocaleDateString('id-ID')
                              : '-'}
                          </p>
                          <p
                            className={`font-bold ${
                              m.vipStatus === 'ACTIVE' ? 'text-[#FFEA00]' : 'text-red-300'
                            }`}
                          >
                            Berakhir:{' '}
                            {m.vipExpiresAt
                              ? new Date(m.vipExpiresAt).toLocaleString('id-ID')
                              : '-'}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ====================================================================
            MENU BROADCAST: PENGUMUMAN ADMIN (JUDUL, ISI, STATUS AKTIF/NONAKTIF)
           ==================================================================== */}
        {activeTab === 'BROADCAST' && (
          <div className="space-y-4">
            <div className="coinova-card space-y-3.5 rounded-2xl border border-[#FFEA00]/35 p-4 text-xs">
              <div>
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-[#FFEA00]">
                  📢 Buat Pengumuman / Admin Broadcast
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Pengumuman aktif akan tampil di halaman utama dan lonceng notifikasi seluruh pemain.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Judul Pengumuman
                  </label>
                  <input
                    type="text"
                    value={broadcastTitleInput}
                    onChange={(e) => setBroadcastTitleInput(e.target.value)}
                    placeholder="Contoh: Info Event Harian & Jadwal Pencairan Withdraw"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs font-bold text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Isi Pengumuman
                  </label>
                  <textarea
                    rows={3}
                    value={broadcastContentInput}
                    onChange={(e) => setBroadcastContentInput(e.target.value)}
                    placeholder="Tulis isi pengumuman untuk seluruh member COINOVA..."
                    className="w-full rounded-xl border border-white/15 bg-[#08080C] p-3 text-xs text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Status Pengumuman
                  </label>
                  <select
                    value={broadcastIsActiveInput ? 'ACTIVE' : 'INACTIVE'}
                    onChange={(e) =>
                      setBroadcastIsActiveInput(e.target.value === 'ACTIVE')
                    }
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                  >
                    <option value="ACTIVE">Aktif (Tampilkan ke User)</option>
                    <option value="INACTIVE">Nonaktif (Sembunyikan)</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                disabled={
                  isSavingBroadcast ||
                  !broadcastTitleInput.trim() ||
                  !broadcastContentInput.trim()
                }
                onClick={() => void handleCreateBroadcast()}
                className="h-11 w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(250,204,21,0.28)] disabled:opacity-40"
              >
                {isSavingBroadcast ? 'Menyimpan...' : 'Terbitkan Pengumuman Broadcast'}
              </button>
            </div>

            <div className="space-y-2.5">
              <h3 className="text-sm font-extrabold text-white">
                Daftar Pengumuman Broadcast ({serverBroadcasts.length})
              </h3>
              {serverBroadcasts.length === 0 ? (
                <div className="coinova-card rounded-2xl p-6 text-center text-xs text-zinc-400">
                  Belum ada pengumuman Admin yang dibuat.
                </div>
              ) : (
                serverBroadcasts.map((bc) => (
                  <div
                    key={bc.broadcastId}
                    className="coinova-card flex flex-wrap items-start justify-between gap-3 rounded-2xl p-4 text-xs"
                  >
                    <div className="space-y-1 flex-1 min-w-[220px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-extrabold text-[#FFEA00]">
                          📢 {bc.title}
                        </span>
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                            bc.isActive
                              ? 'border-[#FFEA00]/60 bg-[#FFEA00]/15 text-[#FFEA00]'
                              : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                          }`}
                        >
                          {bc.isActive ? 'AKTIF' : 'NONAKTIF'}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-zinc-200">{bc.content}</p>
                      <p className="font-mono-num text-[10px] text-zinc-500">
                        Dibuat: {new Date(bc.createdAt).toLocaleString('id-ID')}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void handleToggleBroadcastStatus(bc.broadcastId, !bc.isActive)
                        }
                        className={`h-9 rounded-xl px-3.5 text-xs font-extrabold ${
                          bc.isActive
                            ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A]'
                            : 'border border-white/15 bg-[#101015] text-zinc-400'
                        }`}
                      >
                        {bc.isActive ? 'Aktif' : 'Nonaktif'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteBroadcast(bc.broadcastId)}
                        className="h-9 rounded-xl border border-red-400/50 bg-red-500/15 px-3 text-xs font-bold text-red-200 hover:bg-red-500/25"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ====================================================================
            MENU KODE REDEEM: KELOLA KODE REDEEM / PROMO (CREATE, TOGGLE, DELETE)
           ==================================================================== */}
        {activeTab === 'CODES' && (
          <div className="space-y-4">
            <div className="coinova-card space-y-3.5 rounded-2xl border border-[#FFEA00]/35 p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-extrabold uppercase tracking-wider text-[#FFEA00]">
                    🎁 {editingCodeKey ? `Edit Kode Redeem (${editingCodeKey})` : 'Buat Kode Redeem Baru'}
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Kode redeem tersimpan di database server. Setiap kode mengikuti batas kuota klaim dan hanya dapat digunakan 1x oleh setiap pemain.
                  </p>
                </div>
                {editingCodeKey && (
                  <button
                    type="button"
                    onClick={handleCancelEditCode}
                    className="h-8 rounded-xl border border-white/20 bg-[#14141A] px-3 text-xs font-bold text-zinc-200"
                  >
                    Batal Edit
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Kode Redeem (Huruf Kapital / Angka)
                  </label>
                  <input
                    type="text"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                    placeholder="Contoh: COINOVA2026"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs font-extrabold uppercase text-[#FFEA00] placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Kode unik yang dimasukkan pemain pada menu Klaim Kode.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Deskripsi / Nama Event Kode
                  </label>
                  <input
                    type="text"
                    value={newCodeDesc}
                    onChange={(e) => setNewCodeDesc(e.target.value)}
                    placeholder="Contoh: Bonus Spesial Member COINOVA"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Keterangan hadiah yang muncul di riwayat transaksi pemain.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-zinc-200">
                      Hadiah Coin
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={newCodeCoins}
                      onChange={(e) => setNewCodeCoins(e.target.value)}
                      placeholder="2000"
                      className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-zinc-400">Satuan: Coin</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-zinc-200">
                      Hadiah Diamond
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={newCodeFire}
                      onChange={(e) => setNewCodeFire(e.target.value)}
                      placeholder="5"
                      className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-zinc-400">Satuan: Diamond</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-zinc-200">
                      Limit Kuota Klaim
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={newCodeMax}
                      onChange={(e) => setNewCodeMax(e.target.value)}
                      placeholder="100"
                      className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-zinc-400">Maksimal jumlah user</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-zinc-200">
                      Batas Waktu (Opsional)
                    </label>
                    <input
                      type="datetime-local"
                      value={newCodeExpiresAt}
                      onChange={(e) => setNewCodeExpiresAt(e.target.value)}
                      className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-zinc-400">Kosongkan jika tanpa kadaluarsa</p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isSavingPromo || !newCode.trim()}
                onClick={() => void handleCreatePromoCode()}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(250,204,21,0.28)] disabled:opacity-40"
              >
                <PlusNeonIcon className="h-4 w-4" />
                <span>
                  {isSavingPromo
                    ? 'Menyimpan ke Database...'
                    : editingCodeKey
                    ? 'Simpan Perubahan Kode Redeem'
                    : 'Buat & Simpan Kode Redeem'}
                </span>
              </button>
            </div>

            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-extrabold text-white">
                    Daftar Kode Redeem Tersimpan ({promoCodes.length || rewardCodes.length})
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Kelola status aktif/nonaktif, pantau sisa kuota klaim, atau hapus kode redeem.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void fetchAdminVipAndPromoAndBroadcasts();
                    void fetchServerOverview();
                  }}
                  className="h-8 rounded-xl border border-[#FFEA00]/40 bg-[#18160C] px-3 text-[11px] font-extrabold text-[#FFEA00]"
                >
                  Refresh Kode
                </button>
              </div>

              {(promoCodes.length > 0 ? promoCodes : rewardCodes).length === 0 ? (
                <div className="coinova-card rounded-2xl p-6 text-center text-xs text-zinc-400">
                  Belum ada kode redeem yang terdaftar di database.
                </div>
              ) : (
                (promoCodes.length > 0 ? promoCodes : rewardCodes).map((rc: any) => {
                  const quotaLimit = Math.max(1, Number(rc.quota ?? rc.maxClaims ?? 100));
                  const claimedCount = Math.max(0, Number(rc.claimedCount || 0));
                  const isQuotaFull = claimedCount >= quotaLimit;
                  const isExpired =
                    rc.expiresAt &&
                    Number.isFinite(Date.parse(rc.expiresAt)) &&
                    Date.now() > Date.parse(rc.expiresAt);
                  return (
                    <div
                      key={rc.code}
                      className="coinova-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono-num rounded-lg border border-[#FFEA00]/40 bg-[#18160C] px-2.5 py-1 text-sm font-black tracking-wider text-[#FFEA00]">
                            {rc.code}
                          </span>
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                              rc.isActive && !isQuotaFull && !isExpired
                                ? 'border-[#FFEA00]/60 bg-[#FFEA00]/15 text-[#FFEA00]'
                                : 'border-red-500/40 bg-red-500/15 text-red-300'
                            }`}
                          >
                            {!rc.isActive
                              ? 'NONAKTIF'
                              : isQuotaFull
                              ? 'KUOTA HABIS'
                              : isExpired
                              ? 'KADALUARSA'
                              : 'AKTIF'}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-white">
                          {rc.description || `Kode Redeem ${rc.code}`}
                        </p>
                        <p className="font-mono-num flex flex-wrap items-center gap-2 text-[11px] font-bold text-[#FFEA00]">
                          <span>
                            Hadiah: +{Number(rc.coinReward || 0).toLocaleString('id-ID')} Coin
                          </span>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1">
                            +{Number(rc.fireReward || 0)}{' '}
                            <DiamondIcon className="h-3 w-3 shrink-0" /> Diamond
                          </span>
                          <span>·</span>
                          <span className="text-zinc-300">
                            Diklaim: {claimedCount} / {quotaLimit} User
                          </span>
                        </p>
                        {rc.expiresAt && (
                          <p className="font-mono-num text-[11px] text-zinc-400">
                            Berlaku s/d: {new Date(rc.expiresAt).toLocaleString('id-ID')}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() =>
                            handleEditCodeClick({
                              code: rc.code,
                              description: rc.description || '',
                              coinReward: Number(rc.coinReward || 0),
                              fireReward: Number(rc.fireReward || 0),
                              idrReward: 0,
                              maxClaims: quotaLimit,
                              claimedCount,
                              isActive: Boolean(rc.isActive),
                              updatedAt: rc.updatedAt || new Date().toISOString(),
                            })
                          }
                          className="h-9 rounded-xl border border-white/20 bg-[#14141A] px-3 text-xs font-bold text-white hover:border-[#FFEA00]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() =>
                            void handleTogglePromoCode(rc.code, !rc.isActive)
                          }
                          className={`h-9 rounded-xl px-3.5 text-xs font-extrabold ${
                            rc.isActive
                              ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A]'
                              : 'border border-white/15 bg-[#101015] text-zinc-400'
                          }`}
                        >
                          {rc.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => void handleDeletePromoCode(rc.code)}
                          className="h-9 rounded-xl border border-red-400/50 bg-red-500/15 px-3 text-xs font-bold text-red-200 hover:bg-red-500/25"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {promoClaims.length > 0 && (
              <div className="coinova-card space-y-2.5 rounded-2xl p-4 text-xs">
                <h3 className="text-sm font-extrabold text-white">
                  Riwayat Klaim Kode Redeem ({promoClaims.length})
                </h3>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {promoClaims.slice(0, 30).map((cl) => (
                    <div
                      key={cl.claimId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#08080C] p-2.5 text-[11px]"
                    >
                      <div>
                        <span className="font-mono-num font-extrabold text-[#FFEA00]">
                          [{cl.code}]
                        </span>{' '}
                        <span className="font-bold text-white">{cl.username}</span>{' '}
                        <span className="font-mono-num text-zinc-400">({cl.uid})</span>
                      </div>
                      <div className="font-mono-num text-zinc-300">
                        +{Number(cl.coinReward || 0).toLocaleString('id-ID')} Coin · +
                        {Number(cl.fireReward || 0)} Diamond ·{' '}
                        {new Date(cl.claimedAt).toLocaleString('id-ID')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ====================================================================
            MENU 3: MISI (ADD, EDIT, TOGGLE ACTIVE/INACTIVE TASKS)
           ==================================================================== */}
        {activeTab === 'TASKS' && (
          <div className="space-y-4">
            <div className="coinova-card space-y-3.5 rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-extrabold text-white">
                    {editingTaskId ? 'Edit Misi COINOVA' : 'Tambah Misi Baru'}
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Buat atau perbarui misi harian, pemula, referral, atau kreator beserta hadiah Coin dan Diamond.
                  </p>
                </div>
                {editingTaskId && (
                  <button
                    type="button"
                    onClick={handleCancelEditTask}
                    className="h-8 rounded-xl border border-white/20 bg-[#14141A] px-3 text-xs font-bold text-zinc-200"
                  >
                    Batal Edit
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Judul Misi
                  </label>
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="Contoh: Ketuk Koin 200 Kali"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Nama misi yang tampil di halaman Misi pemain.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Deskripsi Singkat Misi
                  </label>
                  <input
                    type="text"
                    value={newTaskDesc}
                    onChange={(e) => setNewTaskDesc(e.target.value)}
                    placeholder="Contoh: Selesaikan 200 ketukan di arena utama hari ini"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs text-white placeholder:text-zinc-500 focus:border-[#FFEA00] focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Panduan cara menyelesaikan misi bagi pemain.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Kategori Misi
                  </label>
                  <select
                    value={newTaskCategory}
                    onChange={(e) => setNewTaskCategory(e.target.value as TaskCategory)}
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                  >
                    <option value="DAILY">DAILY (Misi Harian)</option>
                    <option value="BEGINNER">BEGINNER (Misi Pemula)</option>
                    <option value="SPECIAL">SPECIAL (Event Spesial)</option>
                    <option value="REFERRAL">REFERRAL (Undang Teman)</option>
                    <option value="CREATOR">CREATOR (Konten Kreator)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Jenis Target Aktivitas
                  </label>
                  <select
                    value={newTaskMetric}
                    onChange={(e) => setNewTaskMetric(e.target.value as TaskMetricType)}
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                  >
                    <option value="TAPS">TAPS (Jumlah Ketukan)</option>
                    <option value="CHECKIN">CHECKIN (Absen Harian)</option>
                    <option value="LEVEL">LEVEL (Capai Level Tertentu)</option>
                    <option value="INVITES">INVITES (Jumlah Teman Diundang)</option>
                    <option value="COINS_EARNED">COINS_EARNED (Total Koin Dikumpulkan)</option>
                    <option value="CREATOR_POST">CREATOR_POST (Kirim Video Kreator)</option>
                    <option value="SHARE">SHARE (Bagikan Link Referral)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-zinc-200">
                    Target Penyelesaian (Angka)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newTaskTarget}
                    onChange={(e) => setNewTaskTarget(e.target.value)}
                    placeholder="Contoh: 100"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Jumlah aktivitas yang harus dicapai pemain untuk klaim hadiah.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-zinc-200">
                      Hadiah Coin
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={newTaskCoins}
                      onChange={(e) => setNewTaskCoins(e.target.value)}
                      placeholder="1500"
                      className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-zinc-400">Satuan: Coin</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-zinc-200">
                      Hadiah Diamond
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={newTaskFire}
                      onChange={(e) => setNewTaskFire(e.target.value)}
                      placeholder="2"
                      className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-zinc-400">Satuan: Diamond</p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={!newTaskTitle.trim()}
                onClick={async () => {
                  const targetTaskId = editingTaskId || `task_custom_${Date.now()}`;
                  const existingTask = tasks.find((t) => t.taskId === editingTaskId);
                  await onSaveTask({
                    taskId: targetTaskId,
                    title: newTaskTitle.trim(),
                    description: newTaskDesc.trim() || newTaskTitle.trim(),
                    category: newTaskCategory,
                    metricType: newTaskMetric,
                    targetCount: Math.max(1, Number(newTaskTarget) || 1),
                    coinReward: Math.max(0, Number(newTaskCoins) || 0),
                    fireReward: Math.max(0, Number(newTaskFire) || 0),
                    idrReward: Math.max(0, Number(newTaskIdr) || 0),
                    isActive: existingTask ? existingTask.isActive : true,
                    updatedAt: new Date().toISOString(),
                  });
                  handleCancelEditTask();
                  notifyAdmin(
                    editingTaskId
                      ? 'Misi berhasil diperbarui!'
                      : 'Misi baru berhasil ditambahkan!',
                    'success'
                  );
                }}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(250,204,21,0.28)] disabled:opacity-40"
              >
                <PlusNeonIcon className="h-4 w-4" />
                <span>{editingTaskId ? 'Simpan Perubahan Misi' : 'Tambah & Simpan Misi'}</span>
              </button>
            </div>

            <div className="space-y-2.5">
              <h3 className="text-sm font-extrabold text-white">
                Daftar Semua Misi ({tasks.length})
              </h3>
              {tasks.map((t) => (
                <div
                  key={t.taskId}
                  className="coinova-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-[#FFEA00]">[{t.category}]</span>
                      <span className="font-extrabold text-white">{t.title}</span>
                      <span className="text-[11px] text-zinc-400">
                        (Target: {t.targetCount} {t.metricType})
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300">{t.description}</p>
                    <p className="font-mono-num flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-[#FFEA00]">
                      <span>
                        Hadiah: +{t.coinReward.toLocaleString('id-ID')} Coin (Rp{' '}
                        {calculateIdrFromCoins(t.coinReward, settings.coinToIdrRate).toLocaleString(
                          'id-ID'
                        )}
                        )
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        +{t.fireReward} <DiamondIcon className="h-3 w-3 shrink-0" /> Diamond
                      </span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleEditTaskClick(t)}
                      className="h-9 rounded-xl border border-white/20 bg-[#14141A] px-3 text-xs font-bold text-white hover:border-[#FFEA00]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await onSaveTask({
                          ...t,
                          isActive: !t.isActive,
                          updatedAt: new Date().toISOString(),
                        });
                        notifyAdmin(
                          !t.isActive
                            ? `Misi "${t.title}" diaktifkan.`
                            : `Misi "${t.title}" dinonaktifkan.`,
                          'success'
                        );
                      }}
                      className={`h-9 rounded-xl px-3.5 text-xs font-extrabold ${
                        t.isActive
                          ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A]'
                          : 'border border-white/15 bg-[#101015] text-zinc-400'
                      }`}
                    >
                      {t.isActive ? 'Aktif' : 'Nonaktif'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ====================================================================
            MENU 5: LEVEL (EDIT LEVEL CONFIG, RUPIAH PRICE, MULTIPLIER, ENERGY, DIAMOND)
           ==================================================================== */}
        {activeTab === 'LEVELS' && (
          <div className="space-y-4">
            {editingLevelNum !== null && (
              <div className="coinova-card space-y-3.5 rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-extrabold text-white">
                      Edit Konfigurasi Level {editingLevelNum}
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Sesuaikan nama level, harga upgrade Rupiah, multiplier ketukan, batas energi, dan bonus Diamond harian.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelEditLevel}
                    className="h-8 rounded-xl border border-white/20 bg-[#14141A] px-3 text-xs font-bold text-zinc-200"
                  >
                    Tutup Edit
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-zinc-200">
                      Nama Level COINOVA
                    </label>
                    <input
                      type="text"
                      value={editLevelName}
                      onChange={(e) => setEditLevelName(e.target.value)}
                      placeholder="Contoh: Gold Vault"
                      className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Nama tier yang tampil pada kartu Level pemain.
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-zinc-200">
                      Harga Upgrade Level (IDR)
                    </label>
                    <input
                      type="number"
                      min={0}
                      disabled={editingLevelNum === 1}
                      value={editLevelPrice}
                      onChange={(e) => setEditLevelPrice(e.target.value)}
                      placeholder="25000"
                      className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs text-white focus:border-[#FFEA00] focus:outline-none disabled:opacity-50"
                    />
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Biaya pembelian level melalui QRIS / E-Wallet (Level 1 gratis).
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-zinc-200">
                      Multiplier Ketukan (x Lipat)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={editLevelMultiplier}
                      onChange={(e) => setEditLevelMultiplier(e.target.value)}
                      placeholder="2"
                      className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Pengali perolehan Coin setiap ketukan (1x = +10 Coin/klik).
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-zinc-200">
                        Kapasitas Energi
                      </label>
                      <input
                        type="number"
                        min={100}
                        value={editLevelEnergy}
                        onChange={(e) => setEditLevelEnergy(e.target.value)}
                        placeholder="500"
                        className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                      />
                      <p className="mt-1 text-[11px] text-zinc-400">Maks energi tap</p>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-zinc-200">
                        Bonus Diamond/Hari
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={editLevelFireBonus}
                        onChange={(e) => setEditLevelFireBonus(e.target.value)}
                        placeholder="2"
                        className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                      />
                      <p className="mt-1 text-[11px] text-zinc-400">Satuan: Diamond</p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    const target = levels.find((l) => l.level === editingLevelNum);
                    if (!target) return;
                    const mult = Math.max(1, Number(editLevelMultiplier) || target.tapMultiplier);
                    await onSaveLevelConfig({
                      ...target,
                      name: editLevelName.trim() || target.name,
                      priceIdr:
                        target.level === 1
                          ? 0
                          : Math.max(0, Number(editLevelPrice) || target.priceIdr || 25000),
                      tapMultiplier: mult,
                      perClickCoins: mult * 10,
                      perCycleClaimCoins: mult * 100,
                      maxEnergy: Math.max(100, Number(editLevelEnergy) || target.maxEnergy),
                      dailyFireBonus: Math.max(0, Number(editLevelFireBonus) || 0),
                    });
                    handleCancelEditLevel();
                    notifyAdmin(
                      `Konfigurasi Level ${target.level} berhasil disimpan!`,
                      'success'
                    );
                  }}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(250,204,21,0.28)]"
                >
                  Simpan Perubahan Level {editingLevelNum}
                </button>
              </div>
            )}

            <div className="space-y-2.5">
              <div>
                <h2 className="text-sm font-extrabold text-white">
                  Daftar Konfigurasi Level COINOVA ({levels.length} Tier)
                </h2>
                <p className="text-xs text-zinc-400">
                  Klik tombol Edit Level untuk mengubah harga upgrade, multiplier koin, atau bonus Diamond.
                </p>
              </div>

              {levels.map((lvl) => (
                <div
                  key={lvl.level}
                  className="coinova-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold text-[#FFEA00]">
                        Lv.{lvl.level}
                      </span>
                      <span className="text-sm font-extrabold text-white">
                        {lvl.name}
                      </span>
                      <span className="text-xs text-zinc-400">
                        ({lvl.titleBadge})
                      </span>
                    </div>
                    <p className="font-mono-num text-xs text-zinc-200">
                      Harga Upgrade:{' '}
                      <strong className="text-[#FFEA00]">
                        {lvl.level === 1
                          ? 'GRATIS'
                          : `Rp ${(lvl.priceIdr || 25000).toLocaleString('id-ID')}`}
                      </strong>{' '}
                      · Per Klik: <strong>+{lvl.perClickCoins || lvl.tapMultiplier * 10} Coin</strong>{' '}
                      · Klaim 10x: <strong>+{lvl.perCycleClaimCoins || lvl.tapMultiplier * 100} Coin</strong>
                    </p>
                    <p className="font-mono-num flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                      <span>Energi Maks: {lvl.maxEnergy}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 text-[#FFEA00]">
                        Bonus Harian: +{lvl.dailyFireBonus}{' '}
                        <DiamondIcon className="h-3 w-3 shrink-0" /> Diamond
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleEditLevelClick(lvl)}
                      className="h-9 rounded-xl border border-white/20 bg-[#14141A] px-3 text-xs font-bold text-white hover:border-[#FFEA00]"
                    >
                      Edit Level
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await onSaveLevelConfig({
                          ...lvl,
                          dailyFireBonus: lvl.dailyFireBonus + 1,
                        });
                        notifyAdmin(
                          `Bonus Diamond harian Lv.${lvl.level} ditambah menjadi +${
                            lvl.dailyFireBonus + 1
                          }.`,
                          'success'
                        );
                      }}
                      className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#FFEA00]/50 bg-[#18160C] px-3 text-xs font-extrabold text-[#FFEA00] hover:bg-[#FFEA00]/20"
                    >
                      <span>+1</span>
                      <DiamondIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>({lvl.dailyFireBonus})</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ====================================================================
            MENU 6: KREATOR (REVIEW VIDEO SUBMISSIONS & GRANT REWARDS)
           ==================================================================== */}
        {activeTab === 'CREATORS' && (
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-extrabold text-white">
                Verifikasi Konten Video Kreator COINOVA ({mergedCreatorSubmissions.length})
              </h2>
              <p className="text-xs text-zinc-400">
                Tinjau kiriman video TikTok, YouTube, atau Instagram pemain dan berikan hadiah Coin serta Diamond.
              </p>
            </div>

            {mergedCreatorSubmissions.length === 0 ? (
              <div className="coinova-card rounded-2xl p-8 text-center text-xs text-zinc-400">
                Belum ada kiriman konten kreator dari pemain.
              </div>
            ) : (
              mergedCreatorSubmissions.map((sub) => {
                const isSelected = selectedCreatorId === sub.submissionId;
                return (
                  <div
                    key={sub.submissionId}
                    className="coinova-card space-y-3 rounded-2xl p-4 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-[#FFEA00]">
                            [{sub.platform}]
                          </span>
                          <span className="text-sm font-extrabold text-white">
                            {sub.username}
                          </span>
                          <span className="text-xs font-bold text-zinc-300">
                            · Status: {sub.status}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-300">{sub.caption}</p>
                        <a
                          href={sub.contentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 pt-0.5 text-xs font-bold text-[#FFEA00] underline"
                        >
                          <span>Buka Link Video Kreator</span>
                          <ExternalLinkNeonIcon className="h-3.5 w-3.5" />
                        </a>
                      </div>

                      {sub.status === 'PENDING' && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCreatorId(isSelected ? null : sub.submissionId);
                              setCreatorCoinInput(String(sub.rewardCoin || 3000));
                              setCreatorFireInput(String(sub.rewardFire || 5));
                              setCreatorNoteInput('Konten video disetujui Admin COINOVA');
                            }}
                            className="h-9 rounded-xl border border-white/20 bg-[#14141A] px-3 text-xs font-bold text-white hover:border-[#FFEA00]"
                          >
                            {isSelected ? 'Tutup Form' : 'Atur Hadiah'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await onReviewCreator(
                                sub,
                                'APPROVED',
                                3000,
                                5,
                                0,
                                'Konten disetujui Admin COINOVA'
                              );
                              void fetchServerOverview();
                              notifyAdmin(
                                `Konten kreator ${sub.username} disetujui (+3.000 Coin & +5 Diamond).`,
                                'success'
                              );
                            }}
                            className="h-9 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-3.5 text-xs font-black text-[#08080A]"
                          >
                            Approve Cepat
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await onReviewCreator(
                                sub,
                                'REJECTED',
                                0,
                                0,
                                0,
                                'Konten belum memenuhi syarat event kreator COINOVA'
                              );
                              void fetchServerOverview();
                              notifyAdmin(
                                `Kiriman konten ${sub.username} ditolak.`,
                                'success'
                              );
                            }}
                            className="h-9 rounded-xl border border-red-400/50 bg-red-500/15 px-3 text-xs font-bold text-red-200"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>

                    {isSelected && sub.status === 'PENDING' && (
                      <div className="space-y-3 rounded-xl border border-[#FFEA00]/30 bg-[#0A0A0E] p-3.5">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div>
                            <label className="mb-1 block text-xs font-bold text-zinc-200">
                              Hadiah Coin
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={creatorCoinInput}
                              onChange={(e) => setCreatorCoinInput(e.target.value)}
                              className="h-10 w-full rounded-xl border border-white/15 bg-[#060608] px-3 font-mono-num text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold text-zinc-200">
                              Hadiah Diamond
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={creatorFireInput}
                              onChange={(e) => setCreatorFireInput(e.target.value)}
                              className="h-10 w-full rounded-xl border border-white/15 bg-[#060608] px-3 font-mono-num text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold text-zinc-200">
                              Catatan Review
                            </label>
                            <input
                              type="text"
                              value={creatorNoteInput}
                              onChange={(e) => setCreatorNoteInput(e.target.value)}
                              className="h-10 w-full rounded-xl border border-white/15 bg-[#060608] px-3 text-xs text-white focus:border-[#FFEA00] focus:outline-none"
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const cReward = Math.max(0, Number(creatorCoinInput) || 0);
                            const fReward = Math.max(0, Number(creatorFireInput) || 0);
                            await onReviewCreator(
                              sub,
                              'APPROVED',
                              cReward,
                              fReward,
                              0,
                              creatorNoteInput.trim() || 'Disetujui Admin COINOVA'
                            );
                            setSelectedCreatorId(null);
                            void fetchServerOverview();
                            notifyAdmin(
                              `Konten ${sub.username} disetujui dengan hadiah +${cReward.toLocaleString('id-ID')} Coin & +${fReward} Diamond!`,
                              'success'
                            );
                          }}
                          className="h-10 w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black text-[#08080A]"
                        >
                          Simpan &amp; Kirim Hadiah Kreator
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ====================================================================
            MENU QRIS: PENGATURAN QRIS PEMBAYARAN DINAMIS (PERSISTEN DI SERVER)
           ==================================================================== */}
        {activeTab === 'QRIS' && (
          <div className="coinova-card mb-4 space-y-4 rounded-2xl border border-[#FFEA00]/35 p-4 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/10 pb-3">
              <div>
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-[#FFEA00]">
                  Pengaturan QRIS
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Kelola gambar QRIS resmi untuk pembayaran Upgrade Level user. Format didukung: PNG, JPG, JPEG, WebP (Maks. 5 MB).
                </p>
              </div>
              <span
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-extrabold uppercase ${
                  activeQris.hasQris && activeQris.imageDataUrl
                    ? 'border-[#FFEA00]/50 bg-[#FFEA00]/15 text-[#FFEA00]'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                }`}
              >
                {activeQris.hasQris && activeQris.imageDataUrl
                  ? 'QRIS Aktif'
                  : 'Belum Ada QRIS'}
              </span>
            </div>

            {/* Hidden File Input for QRIS Upload / Replace */}
            <input
              ref={qrisFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,.png,.jpg,.jpeg,.webp"
              onChange={handleSelectQrisFile}
              className="hidden"
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Left Column: Preview QRIS yang sedang aktif */}
              <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#08080C] p-3.5">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-white">
                      Preview QRIS Aktif Saat Ini
                    </span>
                    {activeQris.updatedAt && (
                      <span className="font-mono-num text-[10px] text-zinc-400">
                        Update: {new Date(activeQris.updatedAt).toLocaleString('id-ID')}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex min-h-[220px] items-center justify-center rounded-xl border border-white/10 bg-[#0C0C12] p-3">
                    {isLoadingQris ? (
                      <p className="text-xs font-bold text-zinc-400">
                        Memuat data QRIS dari server...
                      </p>
                    ) : activeQris.hasQris && activeQris.imageDataUrl ? (
                      <div className="w-full space-y-2 text-center">
                        <div className="mx-auto inline-block overflow-hidden rounded-xl border border-[#FFEA00]/45 bg-white p-2">
                          <img
                            src={activeQris.imageDataUrl}
                            alt="QRIS Aktif COINOVA"
                            className="mx-auto max-h-60 w-auto object-contain"
                          />
                        </div>
                        <p className="truncate text-[11px] font-bold text-zinc-300">
                          {activeQris.fileName || 'qris-coinova.png'}{' '}
                          {activeQris.fileSize > 0
                            ? `(${(activeQris.fileSize / 1024).toFixed(1)} KB)`
                            : ''}
                        </p>
                      </div>
                    ) : (
                      <div className="py-8 text-center">
                        <p className="text-xs font-extrabold text-[#FFEA00]">
                          QRIS pembayaran belum tersedia.
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-400">
                          Silakan upload gambar QRIS asli lalu tekan Simpan QRIS.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {activeQris.hasQris && activeQris.imageDataUrl && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => qrisFileInputRef.current?.click()}
                      className="flex-1 rounded-xl border border-[#FFEA00]/50 bg-[#18160C] px-3 py-2.5 text-center text-xs font-extrabold text-[#FFEA00] transition hover:bg-[#FFEA00]/20"
                    >
                      Ganti QRIS
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteQris}
                      disabled={isDeletingQris}
                      className="rounded-xl border border-red-400/50 bg-red-500/15 px-3.5 py-2.5 text-xs font-extrabold text-red-200 transition hover:bg-red-500/25 disabled:opacity-50"
                    >
                      {isDeletingQris ? 'Menghapus...' : 'Hapus QRIS'}
                    </button>
                  </div>
                )}
              </div>

              {/* Right Column: Upload / Ganti Gambar QRIS Baru & Tombol Simpan QRIS */}
              <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#08080C] p-3.5">
                <div className="space-y-3">
                  <span className="block text-xs font-extrabold uppercase tracking-wider text-white">
                    {activeQris.hasQris
                      ? 'Upload / Ganti Gambar QRIS Baru'
                      : 'Upload Gambar QRIS Asli'}
                  </span>

                  <button
                    type="button"
                    onClick={() => qrisFileInputRef.current?.click()}
                    className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#FFEA00]/60 bg-[#0C0C12] px-4 py-5 text-center transition hover:border-[#FFEA00] hover:bg-[#14130B]"
                  >
                    <UploadNeonIcon className="h-6 w-6 text-[#FFEA00]" />
                    <span className="text-xs font-extrabold text-[#FFEA00]">
                      {draftQrisMeta
                        ? `File Dipilih: ${draftQrisMeta.fileName}`
                        : activeQris.hasQris
                        ? 'Pilih Gambar QRIS Baru'
                        : 'Upload Gambar QRIS'}
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      PNG, JPG, JPEG, atau WebP • Maksimal 5 MB
                    </span>
                  </button>

                  {draftQrisDataUrl && draftQrisMeta && (
                    <div className="space-y-2 rounded-xl border border-[#FFEA00]/40 bg-[#0C0C12] p-3 text-center">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-[#FFEA00]">
                          Preview Gambar Baru (Belum Disimpan)
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setDraftQrisDataUrl(null);
                            setDraftQrisMeta(null);
                            setQrisError(null);
                          }}
                          className="font-bold text-red-300 hover:text-red-200"
                        >
                          Batal Pilih
                        </button>
                      </div>
                      <div className="mx-auto inline-block overflow-hidden rounded-lg border border-white/20 bg-white p-1.5">
                        <img
                          src={draftQrisDataUrl}
                          alt="Preview QRIS Baru"
                          className="mx-auto max-h-44 w-auto object-contain"
                        />
                      </div>
                      <p className="truncate text-[11px] text-zinc-300">
                        {draftQrisMeta.fileName} (
                        {(draftQrisMeta.fileSize / 1024).toFixed(1)} KB)
                      </p>
                    </div>
                  )}

                  {qrisError && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-400/50 bg-red-500/15 p-3 text-xs font-bold text-red-200">
                      <AlertNeonIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                      <span>{qrisError}</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-2">
                  <button
                    type="button"
                    onClick={handleSaveQris}
                    disabled={isSavingQris || !draftQrisDataUrl}
                    className="h-11 w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(250,204,21,0.28)] transition active:scale-[0.99] disabled:opacity-40"
                  >
                    {isSavingQris ? 'Menyimpan QRIS...' : 'Simpan QRIS'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            MENU 8: PENGATURAN (KONFIGURASI EKONOMI TERPUSAT COINOVA)
           ==================================================================== */}
        {activeTab === 'SETTINGS' && (
          <div className="coinova-card space-y-4 rounded-2xl p-4 text-xs">
            <div>
              <h2 className="text-sm font-extrabold uppercase tracking-wider text-[#FFEA00]">
                Pengaturan Ekonomi Terpusat COINOVA
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                Atur parameter reward ketukan, peluang Diamond, batas minimal penarikan E-Wallet, dan komisi undang teman.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-zinc-200">
                  Coin Per Tap Dasar (Coin)
                </label>
                <input
                  type="number"
                  min={1}
                  value={editSettings.coinsPerTap}
                  onChange={(e) =>
                    setEditSettings({
                      ...editSettings,
                      coinsPerTap: Math.max(1, Number(e.target.value) || 10),
                    })
                  }
                  placeholder="Contoh: 10"
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-zinc-400">
                  Jumlah koin dasar yang diperoleh pemain Level 1 setiap ketukan.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-zinc-200">
                  Peluang Drop Diamond Per Tap (%)
                </label>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={editSettings.fireDropChancePercent || 6}
                  onChange={(e) =>
                    setEditSettings({
                      ...editSettings,
                      fireDropChancePercent: Math.min(
                        25,
                        Math.max(1, Number(e.target.value) || 6)
                      ),
                    })
                  }
                  placeholder="Contoh: 6"
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-zinc-400">
                  Persentase peluang munculnya bonus Diamond saat pemain mengetuk koin (1% - 25%).
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-zinc-200">
                  Minimal Withdraw E-Wallet (IDR)
                </label>
                <input
                  type="number"
                  min={1000}
                  value={editSettings.minWithdrawIdr}
                  onChange={(e) =>
                    setEditSettings({
                      ...editSettings,
                      minWithdrawIdr: Math.max(1000, Number(e.target.value) || 50000),
                    })
                  }
                  placeholder="Contoh: 50000"
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-zinc-400">
                  Jumlah minimum saldo yang dapat ditarik pemain.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-zinc-200">
                  Bonus Diamond Referral (Diamond)
                </label>
                <input
                  type="number"
                  min={0}
                  value={editSettings.referralRewardFire}
                  onChange={(e) =>
                    setEditSettings({
                      ...editSettings,
                      referralRewardFire: Math.max(
                        0,
                        Number(e.target.value) || 0
                      ),
                    })
                  }
                  placeholder="Contoh: 2"
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-zinc-400">
                  Jumlah bonus Diamond untuk pengundang saat teman aktif bermain.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-zinc-200">
                  Reward Referral Terverifikasi (IDR)
                </label>
                <input
                  type="number"
                  min={0}
                  value={editSettings.referralRewardIdr}
                  onChange={(e) =>
                    setEditSettings({
                      ...editSettings,
                      referralRewardIdr: Math.max(0, Number(e.target.value) || 2500),
                    })
                  }
                  placeholder="Contoh: 2500"
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-zinc-400">
                  Nilai komisi Rupiah untuk pengundang ketika teman mencapai milestone verifikasi.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-zinc-200">
                  Bonus Coin Referral (Coin)
                </label>
                <input
                  type="number"
                  min={0}
                  value={editSettings.referralRewardCoin}
                  onChange={(e) =>
                    setEditSettings({
                      ...editSettings,
                      referralRewardCoin: Math.max(0, Number(e.target.value) || 25000),
                    })
                  }
                  placeholder="Contoh: 25000"
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#08080C] px-3 font-mono-num text-xs font-bold text-white focus:border-[#FFEA00] focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-zinc-400">
                  Jumlah bonus Coin yang diterima pengundang dari teman yang memenuhi syarat.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={async () => {
                await onSaveGameSettings({
                  ...editSettings,
                  updatedAt: new Date().toISOString(),
                });
                notifyAdmin('Pengaturan ekonomi COINOVA berhasil disimpan!', 'success');
              }}
              className="h-11 w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(250,204,21,0.28)]"
            >
              Simpan Pengaturan Ekonomi
            </button>
          </div>
        )}

        {/* ====================================================================
            MENU 9: AUDIT LOG (ADMIN ACTIVITY LOGS & ANTI-MACRO REVIEW)
           ==================================================================== */}
        {activeTab === 'AUDIT' && (
          <div className="space-y-4">
            {fraudEvents.length > 0 && (
              <div className="coinova-card space-y-2.5 rounded-2xl p-4">
                <h3 className="text-sm font-extrabold text-[#FFEA00]">
                  Peringatan Keamanan / Anti-Auto Clicker ({fraudEvents.length})
                </h3>
                {fraudEvents.map((ev) => (
                  <div
                    key={ev.eventId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0A0A0E] p-3 text-xs"
                  >
                    <div>
                      <p className="font-bold text-white">
                        UID: {ev.uid} · Status: <span className="text-[#FFEA00]">{ev.status}</span>
                      </p>
                      <p className="text-[11px] text-zinc-400">{ev.reason}</p>
                    </div>
                    {ev.status === 'FLAGGED' && adminSession?.token && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await fetch('/api/admin/fraud-action', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${adminSession.token}`,
                              },
                              body: JSON.stringify({
                                eventId: ev.eventId,
                                action: 'CLEAR',
                              }),
                            });
                            fetchServerOverview();
                            notifyAdmin('Peringatan akun telah dibersihkan (Cleared).', 'success');
                          }}
                          className="h-8 rounded-lg border border-white/20 bg-[#14141A] px-2.5 text-[11px] font-bold text-white"
                        >
                          Abaikan
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await fetch('/api/admin/fraud-action', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${adminSession.token}`,
                              },
                              body: JSON.stringify({
                                eventId: ev.eventId,
                                action: 'SUSPEND',
                              }),
                            });
                            fetchServerOverview();
                            notifyAdmin('Akun terindikasi curang telah di-suspend.', 'success');
                          }}
                          className="h-8 rounded-lg border border-red-400/50 bg-red-500/15 px-2.5 text-[11px] font-bold text-red-200"
                        >
                          Suspend
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2.5">
              <div>
                <h2 className="text-sm font-extrabold text-white">
                  Riwayat Aktivitas &amp; Audit Log Admin ({mergedAuditLogs.length})
                </h2>
                <p className="text-xs text-zinc-400">
                  Seluruh tindakan perubahan data oleh administrator tercatat secara otomatis.
                </p>
              </div>

              {mergedAuditLogs.length === 0 ? (
                <div className="coinova-card rounded-2xl p-8 text-center text-xs text-zinc-400">
                  Belum ada riwayat aktivitas admin yang tercatat.
                </div>
              ) : (
                mergedAuditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="coinova-card flex flex-wrap items-center justify-between gap-2 rounded-2xl p-3.5 text-xs"
                  >
                    <div className="space-y-0.5">
                      <p className="font-extrabold text-[#FFEA00]">{log.action}</p>
                      <p className="text-zinc-200">{log.details}</p>
                    </div>
                    <span className="font-mono-num text-[11px] text-zinc-400">
                      {new Date(log.createdAt).toLocaleString('id-ID')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ======================================================================
          MODAL PREVIEW BUKTI PEMBAYARAN UPGRADE LEVEL
         ====================================================================== */}
      {previewProofOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="coinova-card relative w-full max-w-[440px] rounded-3xl border border-[#FFEA00]/40 bg-[#0C0C10] p-5 text-white">
            <button
              type="button"
              onClick={() => setPreviewProofOrder(null)}
              className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/60 text-zinc-300 hover:border-[#FFEA00] hover:text-white"
            >
              <CloseIcon className="h-4 w-4" />
            </button>

            <h3 className=" pr-8 text-sm font-extrabold text-white">
              Bukti Pembayaran Upgrade Level {previewProofOrder.targetLevel} (
              {previewProofOrder.levelName})
            </h3>
            <p className="mt-0.5 text-xs font-bold text-[#FFEA00]">
              {previewProofOrder.username} · Rp{' '}
              {previewProofOrder.priceIdr.toLocaleString('id-ID')} via{' '}
              {previewProofOrder.paymentMethod}
            </p>
            <p className="text-[11px] text-zinc-400">
              Order ID: {previewProofOrder.orderId} · Ref:{' '}
              {previewProofOrder.paymentReference || '-'}
            </p>

            <div className="mt-3 max-h-[65vh] overflow-y-auto rounded-2xl border border-[#FFEA00]/30 bg-[#060608] p-2">
              {previewProofOrder.paymentProofDataUrl ||
              previewProofOrder.paymentProofImage ? (
                <img
                  src={
                    previewProofOrder.paymentProofDataUrl ||
                    previewProofOrder.paymentProofImage
                  }
                  alt="Bukti Pembayaran"
                  className="mx-auto max-h-[58vh] w-auto rounded-xl object-contain"
                />
              ) : (
                <p className="py-12 text-center text-xs text-zinc-400">
                  Tidak ada gambar bukti pembayaran.
                </p>
              )}
            </div>

            {previewProofOrder.status !== 'PAID' &&
              previewProofOrder.status !== 'REJECTED' && (
                <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={async () => {
                      await onReviewUpgradeOrder(
                        previewProofOrder,
                        'PAID',
                        `Bukti pembayaran QRIS Rp${previewProofOrder.priceIdr.toLocaleString('id-ID')} diverifikasi. Level ${previewProofOrder.targetLevel} diaktifkan.`
                      );
                      setPreviewProofOrder(null);
                      notifyAdmin(
                        `Order Level ${previewProofOrder.targetLevel} (${previewProofOrder.username}) berhasil di-approve!`,
                        'success'
                      );
                    }}
                    className="h-10 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black text-[#08080A]"
                  >
                    APPROVE (Aktifkan Level)
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await onReviewUpgradeOrder(
                        previewProofOrder,
                        'REJECTED',
                        'Bukti pembayaran ditolak oleh Admin.'
                      );
                      setPreviewProofOrder(null);
                      notifyAdmin(
                        `Order Level ${previewProofOrder.username} ditolak.`,
                        'success'
                      );
                    }}
                    className="h-10 rounded-xl border border-red-400/50 bg-red-500/15 text-xs font-bold text-red-200"
                  >
                    REJECT (Tolak)
                  </button>
                </div>
              )}
          </div>
        </div>
      )}

      {/* ======================================================================
          MODAL PREVIEW BUKTI PEMBAYARAN VIP
         ====================================================================== */}
      {previewVipProofOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="coinova-card relative w-full max-w-[440px] rounded-3xl border border-[#FFEA00]/40 bg-[#0C0C10] p-5 text-white">
            <button
              type="button"
              onClick={() => setPreviewVipProofOrder(null)}
              className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/60 text-zinc-300 hover:border-[#FFEA00] hover:text-white"
            >
              <CloseIcon className="h-4 w-4" />
            </button>

            <h3 className="pr-8 text-sm font-extrabold text-white">
              Bukti Pembayaran COINOVA VIP (30 Hari)
            </h3>
            <p className="mt-0.5 text-xs font-bold text-[#FFEA00]">
              {previewVipProofOrder.username} · Rp{' '}
              {Number(previewVipProofOrder.priceIdr || 100000).toLocaleString('id-ID')} via{' '}
              {previewVipProofOrder.paymentMethod || 'QRIS'}
            </p>
            <p className="text-[11px] text-zinc-400">
              Order ID: {previewVipProofOrder.orderId} · Ref:{' '}
              {previewVipProofOrder.paymentReference || '-'}
            </p>

            <div className="mt-3 max-h-[65vh] overflow-y-auto rounded-2xl border border-[#FFEA00]/30 bg-[#060608] p-2">
              {previewVipProofOrder.paymentProofDataUrl ? (
                <img
                  src={previewVipProofOrder.paymentProofDataUrl}
                  alt="Bukti Pembayaran VIP"
                  className="mx-auto max-h-[58vh] w-auto rounded-xl object-contain"
                />
              ) : (
                <p className="py-12 text-center text-xs text-zinc-400">
                  Tidak ada gambar bukti pembayaran VIP.
                </p>
              )}
            </div>

            {previewVipProofOrder.status === 'PENDING_VERIFICATION' && (
              <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={vipBusyOrderId === previewVipProofOrder.orderId}
                  onClick={() =>
                    void handleVerifyVipOrder(previewVipProofOrder.orderId, 'APPROVED')
                  }
                  className="h-10 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black text-[#08080A]"
                >
                  Approve VIP (Aktif 30 Hari)
                </button>
                <button
                  type="button"
                  disabled={vipBusyOrderId === previewVipProofOrder.orderId}
                  onClick={() =>
                    void handleVerifyVipOrder(previewVipProofOrder.orderId, 'REJECTED')
                  }
                  className="h-10 rounded-xl border border-red-400/50 bg-red-500/15 text-xs font-bold text-red-200"
                >
                  Reject (Tolak)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
