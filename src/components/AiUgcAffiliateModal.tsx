import React, { useRef, useState } from 'react';
import { CloseIcon, UploadNeonIcon } from './DragonIcons';
import { NovaCoinIcon } from './GameIllustrations';
import { ECONOMY_CONSTANTS } from '../config/economy';

export type UgcReferenceMode =
  | 'Original'
  | 'Follow Video Structure'
  | 'Remix Video Reference';

export interface VideoReferenceAnalysis {
  hook: string;
  scene1: string;
  scene2: string;
  scene3: string;
  camera: string;
  movement: string;
  productPresentation: string;
  lighting: string;
  pacing: string;
  cta: string;
}

export interface UgcGeneratedResult {
  id: string;
  createdAt: string;
  productName: string;
  referenceMode: UgcReferenceMode;
  videoAnalysis?: VideoReferenceAnalysis | null;
  hook: string;
  conceptScript: string;
  caption: string;
  cta: string;
  finalPrompt: string;
}

interface AiUgcAffiliateModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid?: string;
  coinBalance: number;
  onDeductCoins?: (newCoinBalance: number, costCoins: number) => void;
}

const SAVED_UGC_STORAGE_KEY = 'coinova_saved_ugc_prompts_v1';

const ACCEPTED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.mov',
  '.webm',
  '.avi',
  '.mpeg',
  '.mpg',
  '.3gp',
  '.3gpp',
];

const ACCEPTED_VIDEO_MIMES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/avi',
  'video/mpeg',
  'video/mpg',
  'video/3gpp',
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')} (${Math.round(seconds)}s)`;
}

export const AiUgcAffiliateModal: React.FC<AiUgcAffiliateModalProps> = ({
  isOpen,
  onClose,
  uid,
  coinBalance,
  onDeductCoins,
}) => {
  const ugcCostCoins = ECONOMY_CONSTANTS.AI_UGC_GENERATE_COST_COINS || 10000;
  const currentCoinBalance = Math.max(0, Math.floor(Number(coinBalance) || 0));
  const hasEnoughCoins = currentCoinBalance >= ugcCostCoins;
  // 1. Product Reference state
  const [productDataUrl, setProductDataUrl] = useState<string>('');
  const [productFileName, setProductFileName] = useState<string>('');
  const [productFileSize, setProductFileSize] = useState<number>(0);
  const [productName, setProductName] = useState<string>('');
  const [productDescription, setProductDescription] = useState<string>('');

  // 2. Character Reference state
  const [characterDataUrl, setCharacterDataUrl] = useState<string>('');
  const [characterFileName, setCharacterFileName] = useState<string>('');
  const [characterFileSize, setCharacterFileSize] = useState<number>(0);
  const [talentStyle, setTalentStyle] = useState<string>(
    'Kreator UGC wanita/pria Indonesia, natural, ekspresif, pencahayaan bersih'
  );

  // 3. Video Reference state
  const [videoDataUrl, setVideoDataUrl] = useState<string>('');
  const [videoFileName, setVideoFileName] = useState<string>('');
  const [videoFileSize, setVideoFileSize] = useState<number>(0);
  const [videoDurationSec, setVideoDurationSec] = useState<number>(0);
  const [videoCacheKey, setVideoCacheKey] = useState<string>('');
  const [isVideoUploadedOnServer, setIsVideoUploadedOnServer] =
    useState<boolean>(false);
  const [isDraggingVideo, setIsDraggingVideo] = useState<boolean>(false);

  // Reference Mode
  const [referenceMode, setReferenceMode] =
    useState<UgcReferenceMode>('Original');

  // Generation progress & error states
  const [progressStage, setProgressStage] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [currentResult, setCurrentResult] =
    useState<UgcGeneratedResult | null>(null);
  const [copiedField, setCopiedField] = useState<string>('');

  // Saved history
  const [savedResults, setSavedResults] = useState<UgcGeneratedResult[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_UGC_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as UgcGeneratedResult[]) : [];
    } catch {
      return [];
    }
  });

  const productInputRef = useRef<HTMLInputElement | null>(null);
  const characterInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const inFlightGenerateRef = useRef<boolean>(false);

  if (!isOpen) return null;

  const handleSelectImage = (
    file: File | undefined,
    target: 'PRODUCT' | 'CHARACTER'
  ) => {
    if (!file) return;
    setErrorMsg('');
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Format foto tidak didukung. Gunakan JPG, PNG, atau WEBP.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (target === 'PRODUCT') {
        setProductDataUrl(url);
        setProductFileName(file.name);
        setProductFileSize(file.size);
      } else {
        setCharacterDataUrl(url);
        setCharacterFileName(file.name);
        setCharacterFileSize(file.size);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSelectVideoFile = (file: File | undefined) => {
    if (!file) return;
    setErrorMsg('');

    const lowerName = file.name.toLowerCase();
    const hasValidExt = ACCEPTED_VIDEO_EXTENSIONS.some((ext) =>
      lowerName.endsWith(ext)
    );
    const hasValidMime =
      ACCEPTED_VIDEO_MIMES.includes(file.type.toLowerCase()) || hasValidExt;

    if (!hasValidMime) {
      setErrorMsg('Format video tidak didukung.');
      return;
    }

    // Max 20MB limit for smooth browser/API handling
    if (file.size > 20 * 1024 * 1024) {
      setErrorMsg(
        'Video terlalu besar. Gunakan video yang lebih pendek atau lebih kecil.'
      );
      return;
    }

    const newCacheKey = `vid_${file.name}_${file.size}_${file.lastModified}`;
    const reader = new FileReader();
    reader.onload = () => {
      const resultUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!resultUrl) {
        setErrorMsg(
          'Video reference gagal diproses. Coba gunakan video MP4/MOV yang lebih pendek atau berukuran lebih kecil.'
        );
        return;
      }
      setVideoDataUrl(resultUrl);
      setVideoFileName(file.name);
      setVideoFileSize(file.size);
      setVideoDurationSec(0);
      if (newCacheKey !== videoCacheKey) {
        setVideoCacheKey(newCacheKey);
        setIsVideoUploadedOnServer(false);
      }
      if (referenceMode === 'Original') {
        setReferenceMode('Follow Video Structure');
      }
    };
    reader.onerror = () => {
      setErrorMsg(
        'Video reference gagal diproses. Coba gunakan video MP4/MOV yang lebih pendek atau berukuran lebih kecil.'
      );
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveVideo = () => {
    setVideoDataUrl('');
    setVideoFileName('');
    setVideoFileSize(0);
    setVideoDurationSec(0);
    setVideoCacheKey('');
    setIsVideoUploadedOnServer(false);
    if (videoInputRef.current) {
      videoInputRef.current.value = '';
    }
  };

  const handleGenerateUgc = async () => {
    if (inFlightGenerateRef.current || isGenerating) return;
    setErrorMsg('');

    if (!productDataUrl) {
      setErrorMsg(
        '1. PRODUCT REFERENCE wajib diunggah terlebih dahulu sebagai sumber kebenaran utama produk.'
      );
      return;
    }

    if (currentCoinBalance < ugcCostCoins) {
      setErrorMsg(
        `Koin tidak cukup untuk Generate AI UGC. Dibutuhkan ${ugcCostCoins.toLocaleString('id-ID')} Koin (Koin Anda: ${currentCoinBalance.toLocaleString('id-ID')} Koin).`
      );
      return;
    }

    inFlightGenerateRef.current = true;
    setIsGenerating(true);
    try {
      // Step 1 & 2: If video reference is present and mode uses video, upload/cache once per session
      if (videoDataUrl && referenceMode !== 'Original') {
        if (!isVideoUploadedOnServer) {
          setProgressStage('Uploading video...');
          const uploadResp = await fetch('/api/ugc/upload-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: videoFileName,
              fileSize: videoFileSize,
              videoDataUrl,
              cacheKey: videoCacheKey,
            }),
          });
          setProgressStage('Processing video...');
          const uploadData = await uploadResp.json().catch(() => null);
          if (!uploadResp.ok || !uploadData?.ok) {
            throw new Error(
              uploadData?.error ||
                'Video reference gagal diproses. Coba gunakan video MP4/MOV yang lebih pendek atau berukuran lebih kecil.'
            );
          }
          setIsVideoUploadedOnServer(true);
        }
        setProgressStage('Analyzing reference...');
      } else {
        setProgressStage('Analyzing reference...');
      }

      await new Promise((r) => setTimeout(r, 250));
      setProgressStage('Building UGC prompt...');

      const genResp = await fetch('/api/ugc/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: uid || '',
          coinBalance: currentCoinBalance,
          productDataUrl,
          characterDataUrl,
          videoCacheKey:
            videoDataUrl && referenceMode !== 'Original' ? videoCacheKey : '',
          videoDataUrl:
            videoDataUrl && referenceMode !== 'Original' ? videoDataUrl : '',
          referenceMode,
          productName: productName.trim() || productFileName || 'Produk Utama',
          productDescription: productDescription.trim(),
          talentStyle: talentStyle.trim(),
        }),
      });
      const genData = await genResp.json().catch(() => null);
      const validFinalPrompt = String(
        genData?.result?.finalPrompt || ''
      ).trim();

      if (
        !genResp.ok ||
        !genData?.ok ||
        !genData?.result ||
        validFinalPrompt.length < 20
      ) {
        const rawErr = String(genData?.error || '');
        if (
          genResp.status === 503 ||
          /503|UNAVAILABLE|high demand|sibuk|timeout|overloaded/i.test(rawErr) ||
          !rawErr
        ) {
          throw new Error(
            'AI sedang sibuk. Koin kamu tidak berkurang. Silakan coba lagi beberapa saat.'
          );
        }
        throw new Error(rawErr);
      }

      setProgressStage('Ready!');
      const built: UgcGeneratedResult = {
        id: `ugc_${Date.now()}`,
        createdAt: new Date().toISOString(),
        productName: productName.trim() || productFileName || 'Produk Utama',
        referenceMode,
        videoAnalysis: genData.result.videoAnalysis || null,
        hook: genData.result.hook || '',
        conceptScript: genData.result.conceptScript || '',
        caption: genData.result.caption || '',
        cta: genData.result.cta || '',
        finalPrompt: validFinalPrompt,
      };
      setCurrentResult(built);

      // Only deduct coins AFTER valid AI UGC output is confirmed and set
      if (genData.coinDeducted !== false && typeof onDeductCoins === 'function') {
        const chargedCoins = Number(
          genData.coinsCharged ?? genData.costCoins ?? ugcCostCoins
        );
        const nextCoins =
          typeof genData.nextCoinBalance === 'number'
            ? genData.nextCoinBalance
            : typeof genData.newCoinBalance === 'number'
            ? genData.newCoinBalance
            : Math.max(0, currentCoinBalance - chargedCoins);
        onDeductCoins(nextCoins, chargedCoins);
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'AI sedang sibuk. Koin kamu tidak berkurang. Silakan coba lagi beberapa saat.';
      setErrorMsg(
        /503|UNAVAILABLE|high demand|timeout|overloaded|Failed to fetch|NetworkError/i.test(
          msg
        )
          ? 'AI sedang sibuk. Koin kamu tidak berkurang. Silakan coba lagi beberapa saat.'
          : msg
      );
      setProgressStage('');
    } finally {
      setIsGenerating(false);
      inFlightGenerateRef.current = false;
    }
  };

  const handleCopyText = (label: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedField(label);
    window.setTimeout(() => setCopiedField(''), 2000);
  };

  const handleSaveCurrentResult = () => {
    if (!currentResult) return;
    setSavedResults((prev) => {
      const exists = prev.some((r) => r.id === currentResult.id);
      const next = exists ? prev : [currentResult, ...prev].slice(0, 20);
      try {
        localStorage.setItem(SAVED_UGC_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore quota
      }
      return next;
    });
    setCopiedField('SAVED');
    window.setTimeout(() => setCopiedField(''), 2000);
  };

  const handleExportCurrentResult = () => {
    if (!currentResult) return;
    const content = [
      `=== COINOVA AI UGC AFFILIATE EXPORT ===`,
      `Produk: ${currentResult.productName}`,
      `Reference Mode: ${currentResult.referenceMode}`,
      `Waktu: ${new Date(currentResult.createdAt).toLocaleString('id-ID')}`,
      ``,
      `--- HOOK ---`,
      currentResult.hook,
      ``,
      `--- KONSEP / SCRIPT UGC ---`,
      currentResult.conceptScript,
      ``,
      `--- CAPTION ---`,
      currentResult.caption,
      ``,
      `--- CTA ---`,
      currentResult.cta,
      ``,
      `--- FINAL VIDEO PROMPT ---`,
      currentResult.finalPrompt,
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coinova-ugc-${currentResult.id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/90 p-2 backdrop-blur-md sm:items-center">
      <div className="max-h-[92dvh] w-full max-w-[420px] overflow-y-auto rounded-[26px] border border-[#FFEA00]/45 bg-[#09090D] p-4 text-white shadow-[0_0_45px_rgba(255,234,0,0.2)] no-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#FACC15]/20 pb-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#FFEA00]">
              COINOVA CREATOR STUDIO
            </span>
            <h3 className="text-base font-extrabold text-white">
              AI UGC AFFILIATE
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-[#FFEA00]/45 bg-[#14130A] px-2.5 py-1 text-[11px] font-extrabold text-[#FFEA00]">
              <NovaCoinIcon className="h-3.5 w-3.5" />
              <span className="font-mono-num">
                {currentCoinBalance.toLocaleString('id-ID')} Koin
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/15 bg-white/5 p-1.5 text-zinc-300 hover:text-white"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3.5 space-y-3.5">
          {/* ================================================================
              1. PRODUCT REFERENCE (WAJIB)
             ================================================================ */}
          <div className="rounded-2xl border border-[#FACC15]/30 bg-[#0D0D12] p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#FFEA00]">
                1. PRODUCT REFERENCE
              </span>
              <span className="text-[10px] font-bold uppercase text-[#FACC15]">
                REQUIRED
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400">
              Sumber kebenaran utama produk (Anti-Ubah: bentuk, warna, logo, dan detail mengikuti foto produk).
            </p>

            <input
              ref={productInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) =>
                handleSelectImage(e.target.files?.[0], 'PRODUCT')
              }
              className="hidden"
            />

            {!productDataUrl ? (
              <button
                type="button"
                onClick={() => productInputRef.current?.click()}
                className="mt-2.5 flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#FFEA00]/45 bg-[#08080B] py-4 text-center transition hover:border-[#FFEA00]"
              >
                <UploadNeonIcon className="h-6 w-6 text-[#FFEA00]" />
                <span className="text-xs font-extrabold text-[#FFEA00]">
                  Upload Foto Produk
                </span>
                <span className="text-[10px] text-zinc-500">
                  JPG, PNG, WEBP
                </span>
              </button>
            ) : (
              <div className="mt-2.5 rounded-xl border border-[#FFEA00]/40 bg-[#08080B] p-2.5">
                <img
                  src={productDataUrl}
                  alt="Product Reference"
                  className="mx-auto max-h-36 rounded-lg object-contain"
                />
                <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-300">
                  <span className="truncate font-bold">{productFileName}</span>
                  <span className="font-mono-num text-zinc-400">
                    {formatFileSize(productFileSize)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => productInputRef.current?.click()}
                    className="rounded-lg border border-[#FFEA00]/40 bg-[#14130B] py-1.5 text-[11px] font-bold text-[#FFEA00]"
                  >
                    Ganti Foto
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProductDataUrl('');
                      setProductFileName('');
                      setProductFileSize(0);
                    }}
                    className="rounded-lg border border-red-400/35 bg-red-500/10 py-1.5 text-[11px] font-bold text-red-300"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            )}

            <div className="mt-2.5 space-y-2">
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Nama Produk (misal: Magnetic Phone Cooler X9)"
                className="w-full rounded-xl border border-white/15 bg-[#07070A] px-3 py-2 text-xs font-semibold text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
              />
              <textarea
                rows={2}
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                placeholder="Deskripsi singkat manfaat/fitur utama produk..."
                className="w-full resize-none rounded-xl border border-white/15 bg-[#07070A] p-2.5 text-xs font-semibold text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
              />
            </div>
          </div>

          {/* ================================================================
              2. CHARACTER REFERENCE (OPTIONAL)
             ================================================================ */}
          <div className="rounded-2xl border border-white/15 bg-[#0D0D12] p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-white">
                2. CHARACTER REFERENCE
              </span>
              <span className="text-[10px] font-bold uppercase text-zinc-400">
                OPTIONAL
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400">
              Upload referensi visual kreator/talent (hairstyle, outfit, style) atau gunakan deskripsi talent.
            </p>

            <input
              ref={characterInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) =>
                handleSelectImage(e.target.files?.[0], 'CHARACTER')
              }
              className="hidden"
            />

            {!characterDataUrl ? (
              <button
                type="button"
                onClick={() => characterInputRef.current?.click()}
                className="mt-2.5 flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/25 bg-[#08080B] py-3 text-center transition hover:border-[#FFEA00]/60"
              >
                <span className="text-xs font-bold text-[#FACC15]">
                  + Upload Character Reference
                </span>
                <span className="text-[10px] text-zinc-500">
                  Opsional (JPG / PNG / WEBP)
                </span>
              </button>
            ) : (
              <div className="mt-2.5 rounded-xl border border-[#FFEA00]/35 bg-[#08080B] p-2.5">
                <img
                  src={characterDataUrl}
                  alt="Character Reference"
                  className="mx-auto max-h-32 rounded-lg object-contain"
                />
                <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-300">
                  <span className="truncate font-bold">{characterFileName}</span>
                  <span className="font-mono-num text-zinc-400">
                    {formatFileSize(characterFileSize)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => characterInputRef.current?.click()}
                    className="rounded-lg border border-[#FFEA00]/40 bg-[#14130B] py-1.5 text-[11px] font-bold text-[#FFEA00]"
                  >
                    Ganti Karakter
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCharacterDataUrl('');
                      setCharacterFileName('');
                      setCharacterFileSize(0);
                    }}
                    className="rounded-lg border border-red-400/35 bg-red-500/10 py-1.5 text-[11px] font-bold text-red-300"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}

            <input
              type="text"
              value={talentStyle}
              onChange={(e) => setTalentStyle(e.target.value)}
              placeholder="Gaya Talent/Karakter..."
              className="mt-2.5 w-full rounded-xl border border-white/15 bg-[#07070A] px-3 py-2 text-xs font-semibold text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
            />
          </div>

          {/* ================================================================
              3. VIDEO REFERENCE (OPTIONAL)
             ================================================================ */}
          <div className="rounded-2xl border border-[#FFEA00]/35 bg-[#0D0D12] p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#FFEA00]">
                3. VIDEO REFERENCE
              </span>
              <span className="text-[10px] font-bold uppercase text-zinc-400">
                OPTIONAL
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-300">
              Upload video referensi untuk menganalisis struktur shot, gerakan kamera, pacing, gesture, framing, dan cara produk ditampilkan.
            </p>

            <input
              ref={videoInputRef}
              type="file"
              accept=".mp4,.mov,.webm,.avi,.mpeg,.mpg,.3gp,.3gpp,video/mp4,video/quicktime,video/webm,video/x-msvideo,video/mpeg,video/3gpp"
              onChange={(e) => handleSelectVideoFile(e.target.files?.[0])}
              className="hidden"
            />

            {!videoDataUrl ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingVideo(true);
                }}
                onDragLeave={() => setIsDraggingVideo(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingVideo(false);
                  handleSelectVideoFile(e.dataTransfer.files?.[0]);
                }}
                onClick={() => videoInputRef.current?.click()}
                className={`mt-2.5 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed py-4 text-center transition ${
                  isDraggingVideo
                    ? 'border-[#FFEA00] bg-[#FFEA00]/10'
                    : 'border-[#FFEA00]/45 bg-[#08080B] hover:border-[#FFEA00]'
                }`}
              >
                <UploadNeonIcon className="h-6 w-6 text-[#FFEA00]" />
                <span className="text-xs font-extrabold text-[#FFEA00]">
                  Upload Video Reference
                </span>
                <span className="text-[10px] text-zinc-400">
                  Drag &amp; drop atau klik (MP4, MOV, WEBM, AVI, MPEG, MPG, 3GPP)
                </span>
              </div>
            ) : (
              <div className="mt-2.5 rounded-xl border border-[#FFEA00]/45 bg-[#08080B] p-2.5">
                <video
                  src={videoDataUrl}
                  controls
                  playsInline
                  onLoadedMetadata={(e) => {
                    const dur = e.currentTarget.duration;
                    if (Number.isFinite(dur)) {
                      setVideoDurationSec(dur);
                    }
                  }}
                  className="mx-auto max-h-48 w-full rounded-lg bg-black"
                />
                <div className="mt-2 space-y-1 text-[11px]">
                  <div className="flex items-center justify-between text-zinc-200">
                    <span className="font-semibold text-zinc-400">Nama File:</span>
                    <span className="max-w-[210px] truncate font-bold text-white">
                      {videoFileName}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span className="font-semibold text-zinc-400">Durasi Video:</span>
                    <span className="font-mono-num font-bold text-[#FFEA00]">
                      {videoDurationSec > 0
                        ? formatDuration(videoDurationSec)
                        : 'Terdeteksi saat diputar'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-200">
                    <span className="font-semibold text-zinc-400">Ukuran File:</span>
                    <span className="font-mono-num font-bold text-zinc-300">
                      {formatFileSize(videoFileSize)}
                    </span>
                  </div>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    className="rounded-lg border border-[#FFEA00]/45 bg-[#14130B] py-1.5 text-[11px] font-bold text-[#FFEA00]"
                  >
                    Ganti Video
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveVideo}
                    className="rounded-lg border border-red-400/35 bg-red-500/10 py-1.5 text-[11px] font-bold text-red-300"
                  >
                    Remove Video
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ================================================================
              REFERENCE MODE & STATUS SUMMARY
             ================================================================ */}
          <div className="rounded-2xl border border-white/15 bg-[#0D0D12] p-3.5">
            <p className="text-xs font-extrabold uppercase tracking-wider text-[#FACC15]">
              REFERENCE MODE
            </p>
            <div className="mt-2 grid grid-cols-1 gap-1.5">
              {(
                [
                  'Original',
                  'Follow Video Structure',
                  'Remix Video Reference',
                ] as UgcReferenceMode[]
              ).map((mode) => {
                const active = referenceMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setReferenceMode(mode)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${
                      active
                        ? 'border-[#FFEA00] bg-[#19170B] text-[#FFEA00]'
                        : 'border-white/10 bg-[#08080B] text-zinc-300 hover:border-white/25'
                    }`}
                  >
                    <span>{mode}</span>
                    <span>{active ? '●' : '○'}</span>
                  </button>
                );
              })}
            </div>

            {/* Status Checklist */}
            <div className="mt-3 rounded-xl border border-white/10 bg-[#08080B] p-2.5 text-[11px]">
              <div className="flex items-center justify-between py-0.5">
                <span className="text-zinc-400">Product Reference:</span>
                <span
                  className={
                    productDataUrl
                      ? 'font-bold text-[#FFEA00]'
                      : 'font-bold text-red-400'
                  }
                >
                  {productDataUrl ? '✓' : 'Wajib Diunggah'}
                </span>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <span className="text-zinc-400">Character Reference:</span>
                <span className="font-bold text-zinc-200">
                  {characterDataUrl ? '✓' : 'Optional'}
                </span>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <span className="text-zinc-400">Video Reference:</span>
                <span className="font-bold text-zinc-200">
                  {videoDataUrl ? '✓' : 'Optional'}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between border-t border-white/10 pt-1.5">
                <span className="font-bold text-zinc-300">Biaya Generate:</span>
                <span className="font-mono-num flex items-center gap-1 font-extrabold text-[#FFEA00]">
                  <NovaCoinIcon className="h-3.5 w-3.5" />
                  {ugcCostCoins.toLocaleString('id-ID')} Koin
                </span>
              </div>
              <div className="flex items-center justify-between py-0.5">
                <span className="text-zinc-400">Koin Saya:</span>
                <span
                  className={`font-mono-num font-extrabold ${
                    hasEnoughCoins ? 'text-white' : 'text-red-400'
                  }`}
                >
                  {currentCoinBalance.toLocaleString('id-ID')} Koin
                </span>
              </div>
            </div>

            {!hasEnoughCoins && (
              <div className="mt-2.5 rounded-xl border border-red-400/45 bg-red-500/10 px-3 py-2 text-center text-[11px] font-extrabold text-red-300">
                Koin tidak cukup ({currentCoinBalance.toLocaleString('id-ID')} /{' '}
                {ugcCostCoins.toLocaleString('id-ID')} Koin). Tap di Home atau klaim Task terlebih dahulu!
              </div>
            )}

            {progressStage && (
              <div className="mt-2.5 rounded-xl border border-[#FFEA00]/40 bg-[#14130B] px-3 py-2 text-center text-xs font-extrabold text-[#FFEA00]">
                {progressStage}
              </div>
            )}

            {errorMsg && (
              <div className="mt-2.5 space-y-2 rounded-xl border border-red-400/50 bg-red-500/15 p-3 text-xs text-red-200">
                <p className="font-bold">{errorMsg}</p>
                <button
                  type="button"
                  onClick={handleGenerateUgc}
                  className="rounded-lg border border-[#FFEA00]/50 bg-[#14130B] px-3 py-1.5 text-[11px] font-extrabold text-[#FFEA00]"
                >
                  Coba Lagi
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={isGenerating || !hasEnoughCoins}
              onClick={handleGenerateUgc}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-3 text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(255,234,0,0.3)] disabled:opacity-50"
            >
              {isGenerating ? (
                <span>{progressStage || 'Processing...'}</span>
              ) : (
                <>
                  <span>GENERATE AI UGC</span>
                  <span className="rounded-md bg-[#08080A]/15 px-2 py-0.5 font-mono-num text-[11px] font-black">
                    -{ugcCostCoins.toLocaleString('id-ID')} Koin
                  </span>
                </>
              )}
            </button>
          </div>

          {/* ================================================================
              GENERATED OUTPUT SECTION
             ================================================================ */}
          {currentResult && (
            <div className="space-y-3 rounded-2xl border border-[#FFEA00]/45 bg-[#0D0D12] p-3.5">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#FFEA00]">
                  HASIL AI UGC AFFILIATE
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSaveCurrentResult}
                    className="rounded-lg border border-[#FFEA00]/40 bg-[#14130B] px-2.5 py-1 text-[10px] font-extrabold text-[#FFEA00]"
                  >
                    {copiedField === 'SAVED' ? 'Tersimpan ✓' : 'Simpan Hasil'}
                  </button>
                  <button
                    type="button"
                    onClick={handleExportCurrentResult}
                    className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1 text-[10px] font-extrabold text-white"
                  >
                    Export .TXT
                  </button>
                </div>
              </div>

              {/* Video Reference Analysis Summary */}
              {currentResult.videoAnalysis && (
                <div className="rounded-xl border border-[#FACC15]/25 bg-[#08080B] p-3 text-xs">
                  <p className="font-extrabold uppercase tracking-wider text-[#FACC15]">
                    VIDEO REFERENCE ANALYSIS
                  </p>
                  <div className="mt-2 space-y-1.5 text-[11px] text-zinc-300">
                    <p>
                      <strong className="text-white">Hook:</strong>{' '}
                      {currentResult.videoAnalysis.hook}
                    </p>
                    <p>
                      <strong className="text-white">Scene 1:</strong>{' '}
                      {currentResult.videoAnalysis.scene1}
                    </p>
                    <p>
                      <strong className="text-white">Scene 2:</strong>{' '}
                      {currentResult.videoAnalysis.scene2}
                    </p>
                    <p>
                      <strong className="text-white">Scene 3:</strong>{' '}
                      {currentResult.videoAnalysis.scene3}
                    </p>
                    <p>
                      <strong className="text-white">Camera:</strong>{' '}
                      {currentResult.videoAnalysis.camera}
                    </p>
                    <p>
                      <strong className="text-white">Movement:</strong>{' '}
                      {currentResult.videoAnalysis.movement}
                    </p>
                    <p>
                      <strong className="text-white">
                        Product presentation:
                      </strong>{' '}
                      {currentResult.videoAnalysis.productPresentation}
                    </p>
                    <p>
                      <strong className="text-white">Lighting:</strong>{' '}
                      {currentResult.videoAnalysis.lighting}
                    </p>
                    <p>
                      <strong className="text-white">Pacing:</strong>{' '}
                      {currentResult.videoAnalysis.pacing}
                    </p>
                    <p>
                      <strong className="text-white">CTA:</strong>{' '}
                      {currentResult.videoAnalysis.cta}
                    </p>
                  </div>
                </div>
              )}

              {/* Hook, Script, Caption, CTA */}
              <div className="space-y-2 text-xs">
                <div className="rounded-xl border border-white/10 bg-[#08080B] p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#FACC15]">HOOK</span>
                    <button
                      type="button"
                      onClick={() => handleCopyText('HOOK', currentResult.hook)}
                      className="text-[10px] font-bold text-zinc-400 hover:text-white"
                    >
                      {copiedField === 'HOOK' ? 'Disalin ✓' : 'Salin'}
                    </button>
                  </div>
                  <p className="mt-1 text-zinc-200">{currentResult.hook}</p>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#08080B] p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#FACC15]">
                      KONSEP / SCRIPT UGC
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyText('SCRIPT', currentResult.conceptScript)
                      }
                      className="text-[10px] font-bold text-zinc-400 hover:text-white"
                    >
                      {copiedField === 'SCRIPT' ? 'Disalin ✓' : 'Salin'}
                    </button>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-zinc-200">
                    {currentResult.conceptScript}
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#08080B] p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#FACC15]">CAPTION</span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyText('CAPTION', currentResult.caption)
                      }
                      className="text-[10px] font-bold text-zinc-400 hover:text-white"
                    >
                      {copiedField === 'CAPTION' ? 'Disalin ✓' : 'Salin'}
                    </button>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-zinc-200">
                    {currentResult.caption}
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#08080B] p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#FACC15]">CTA</span>
                    <button
                      type="button"
                      onClick={() => handleCopyText('CTA', currentResult.cta)}
                      className="text-[10px] font-bold text-zinc-400 hover:text-white"
                    >
                      {copiedField === 'CTA' ? 'Disalin ✓' : 'Salin'}
                    </button>
                  </div>
                  <p className="mt-1 text-zinc-200">{currentResult.cta}</p>
                </div>
              </div>

              {/* Final Video Prompt */}
              <div className="rounded-xl border border-[#FFEA00]/40 bg-[#08080B] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase text-[#FFEA00]">
                    FINAL VIDEO PROMPT (9:16 UGC)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText('PROMPT', currentResult.finalPrompt)
                    }
                    className="rounded-lg bg-[#FFEA00] px-2.5 py-1 text-[10px] font-black text-[#08080A]"
                  >
                    {copiedField === 'PROMPT' ? 'TERSALIN ✓' : 'COPY PROMPT'}
                  </button>
                </div>
                <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-200">
                  {currentResult.finalPrompt}
                </pre>
              </div>
            </div>
          )}

          {/* Saved History */}
          {savedResults.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-[#0D0D12] p-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-400">
                Riwayat Prompt Tersimpan ({savedResults.length})
              </p>
              <div className="mt-2 space-y-1.5">
                {savedResults.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCurrentResult(item)}
                    className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-[#08080B] px-3 py-2 text-left text-xs hover:border-[#FFEA00]/40"
                  >
                    <span className="truncate font-bold text-white">
                      {item.productName} ({item.referenceMode})
                    </span>
                    <span className="text-[10px] text-[#FFEA00]">Buka</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
