import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'Terjadi kesalahan tidak terduga.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in COINOVA:', error, errorInfo);
  }

  private handleReload = () => {
    this.setState({ hasError: false, errorMessage: '' });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      let parsedDetails: Record<string, unknown> | null = null;
      try {
        parsedDetails = JSON.parse(this.state.errorMessage);
      } catch {
        parsedDetails = null;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-[#060608] p-4 text-white">
          <div className="coinova-card-glow w-full max-w-md rounded-3xl p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#FFEA00]/45 bg-[#FFEA00]/15 text-[#FFEA00]">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-[#FFEA00]">
                  Gangguan Sistem COINOVA
                </h2>
                <p className="text-xs text-zinc-400">
                  Proteksi keamanan otomatis mendeteksi kendala akses data
                </p>
              </div>
            </div>

            <div className="mb-5 rounded-2xl border border-[#FACC15]/30 bg-[#0B0B0F] p-3.5 text-xs text-zinc-300">
              {parsedDetails ? (
                <div className="space-y-1">
                  <p className="font-semibold text-[#FFEA00]">
                    Operasi: {String(parsedDetails.operationType || 'UNKNOWN')}
                  </p>
                  <p className="break-all text-zinc-400">
                    Path: {String(parsedDetails.path || '-')}
                  </p>
                  <p className="mt-1 text-zinc-200">
                    Detail: {String(parsedDetails.error || 'Akses ditolak atau koneksi terputus.')}
                  </p>
                </div>
              ) : (
                <p className="break-words">{this.state.errorMessage}</p>
              )}
            </div>

            <button
              type="button"
              onClick={this.handleReload}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-3 text-sm font-black uppercase text-[#08080A] shadow-[0_0_20px_rgba(255,234,0,0.35)] transition active:scale-[0.99]"
            >
              <RefreshCw className="h-4 w-4" />
              Muat Ulang COINOVA
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
