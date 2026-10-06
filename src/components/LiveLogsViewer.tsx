import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Terminal,
  Play,
  Pause,
  Trash2,
  Download,
  Copy,
  Search,
  Check,
  Sparkles,
} from 'lucide-react';
import { useHub } from '../context/HubContext';

export const LiveLogsViewer: React.FC = () => {
  const {
    logs,
    allServices,
    isStreamingLogs,
    setIsStreamingLogs,
    clearLogs,
    addLog,
    sendCustomAlert,
  } = useHub();

  const [selectedService, setSelectedService] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [searchTerm, setSearchQuery] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  // The "all services" option was removed — always keep one real service
  // selected (auto-selects the first one when the service list changes).
  useEffect(() => {
    if (allServices.length === 0) return;
    if (selectedService !== 'all' && allServices.some((s) => s.name === selectedService)) return;
    setSelectedService(allServices[0].name);
  }, [allServices, selectedService]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  // Filter logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (selectedService !== 'all' && log.serviceName !== selectedService) {
        return false;
      }
      if (selectedLevel !== 'all' && log.level !== selectedLevel) {
        return false;
      }
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        const matchMessage = log.message.toLowerCase().includes(query);
        const matchService = log.serviceName.toLowerCase().includes(query);
        if (!matchMessage && !matchService) return false;
      }
      return true;
    });
  }, [logs, selectedService, selectedLevel, searchTerm]);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs, autoScroll]);

  // Copy logs to clipboard
  const handleCopyLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.serviceName}] ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download logs as file
  const handleDownloadLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.serviceName}] ${l.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `railway-hub-logs-${new Date().toISOString().slice(0, 10)}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Simulator Triggers
  const triggerSimulatedError = () => {
    const targetService = allServices[0]?.name || 'api-gateway-v2';
    addLog({
      level: 'error',
      serviceName: targetService,
      message: `[FATAL] UnhandledPromiseRejection: Connection reset by peer at Socket.onTimeout (syscall connect: ECONNREFUSED 10.0.4.12:5432)`,
    });
    sendCustomAlert('خطای سرور و کانتینر', `سرویس ${targetService} با خطای ارتباط دیتابیس مواجه شد.`, 'critical', targetService);
  };

  const triggerSimulatedWarning = () => {
    const targetService = allServices[1]?.name || 'auto-poster-bot';
    addLog({
      level: 'warn',
      serviceName: targetService,
      message: `[TELEGRAM] Rate limit threshold reached for bot token. Backing off requests for 15 seconds.`,
    });
  };

  return (
    <div className="space-y-4 pb-20 lg:pb-8 w-full max-w-full overflow-hidden">
      
      {/* Header & Stream Control */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base sm:text-xl font-black text-white flex items-center gap-2">
            <Terminal className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-400 shrink-0" />
            <span>کنسول لاگ زنده نودها</span>
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            مشاهده جریانی و بی‌درنگ لاگ‌های کانتینرها و بیلدها
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto justify-start sm:justify-end">
          <button
            onClick={() => setIsStreamingLogs(!isStreamingLogs)}
            className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
              isStreamingLogs
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            {isStreamingLogs ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                توقف استریم
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                ادامه
              </>
            )}
          </button>

          <button
            onClick={handleCopyLogs}
            className="flex items-center gap-1 rounded-xl border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-neutral-300 hover:text-white transition"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            کپی
          </button>

          <button
            onClick={handleDownloadLogs}
            className="flex items-center gap-1 rounded-xl border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-neutral-300 hover:text-white transition"
          >
            <Download className="h-3.5 w-3.5" />
            دانلود
          </button>

          <button
            onClick={clearLogs}
            className="flex items-center gap-1 rounded-xl border border-neutral-800 bg-neutral-900 p-1.5 text-xs text-neutral-400 hover:text-rose-400 transition"
            title="پاک‌سازی"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 rounded-2xl bg-neutral-900/70 p-2.5 border border-neutral-800 backdrop-blur-md max-w-full overflow-hidden">
        
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-neutral-400" />
          <input
            type="text"
            placeholder="فیلتر متن لاگ (مثلا: error, GET)..."
            value={searchTerm}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 pr-9 pl-3 py-1.5 font-mono text-xs text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-3 sm:flex sm:items-center gap-2">
          {/* Service filter */}
          <select
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
            className="rounded-xl border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-300 focus:border-purple-500 focus:outline-none cursor-pointer truncate"
          >
            {allServices.length === 0 && <option value="all">— سرویسی موجود نیست —</option>}
            {allServices.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Level filter */}
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="rounded-xl border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-300 focus:border-purple-500 focus:outline-none cursor-pointer truncate"
          >
            <option value="all">همه سطوح</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>

          {/* Auto scroll checkbox */}
          <label className="flex items-center justify-center gap-1.5 text-[11px] text-neutral-400 cursor-pointer select-none bg-neutral-950 px-2 py-1.5 rounded-xl border border-neutral-800">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded accent-purple-600 h-3.5 w-3.5"
            />
            <span>اسکرول</span>
          </label>
        </div>

      </div>

      {/* Terminal View */}
      <div className="relative rounded-2xl border border-neutral-800 bg-neutral-950 p-3 sm:p-5 font-mono shadow-2xl overflow-hidden terminal-grid max-w-full">
        
        {/* Terminal Title Bar */}
        <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5 mb-2.5 text-xs text-neutral-400">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1 shrink-0">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
            </div>
            <span className="text-neutral-300 font-semibold truncate text-[11px] sm:text-xs">railway-nodes.log</span>
            {isStreamingLogs && (
              <span className="hidden xs:flex items-center gap-1 text-[10px] text-emerald-400 shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                Live
              </span>
            )}
          </div>

          <div className="text-[10px] sm:text-[11px] text-neutral-500 shrink-0">
            {filteredLogs.length} لاگ
          </div>
        </div>

        {/* Logs Output */}
        <div
          ref={terminalContainerRef}
          className="max-h-[450px] min-h-[300px] overflow-y-auto space-y-1 text-xs leading-relaxed max-w-full"
          dir="ltr"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-neutral-600">
              <Terminal className="h-8 w-8 mb-2 opacity-50" />
              <span>هیچ لاگی با این مشخصات یافت نشد.</span>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isError = log.level === 'error';
              const isWarn = log.level === 'warn';

              return (
                <div
                  key={log.id}
                  className={`group flex items-start gap-1.5 sm:gap-2.5 rounded px-1.5 py-0.5 transition hover:bg-neutral-900/60 max-w-full overflow-hidden break-all ${
                    isError
                      ? 'bg-rose-950/20 text-rose-300 border-l-2 border-rose-500'
                      : isWarn
                      ? 'bg-amber-950/20 text-amber-300 border-l-2 border-amber-500'
                      : 'text-neutral-300'
                  }`}
                >
                  <span className="text-neutral-500 shrink-0 select-none text-[10px]">
                    {log.timestamp}
                  </span>

                  <span
                    className={`shrink-0 font-bold text-[10px] px-1 py-0.2 rounded truncate max-w-[90px] ${
                      isError
                        ? 'bg-rose-500/20 text-rose-400'
                        : isWarn
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-purple-500/20 text-purple-300'
                    }`}
                  >
                    {log.serviceName}
                  </span>

                  <span className="break-all whitespace-pre-wrap">{log.message}</span>
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>

        {/* Quick Simulation Bar */}
        <div className="mt-3 pt-2.5 border-t border-neutral-800/80 flex items-center justify-between text-xs flex-wrap gap-2">
          <span className="text-neutral-400 flex items-center gap-1 text-[11px]">
            <Sparkles className="h-3.5 w-3.5 text-purple-400 shrink-0" />
            تست و شبیه‌سازی:
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={triggerSimulatedWarning}
              className="rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-1 text-[10px] hover:bg-amber-500/20"
            >
              Warn
            </button>
            <button
              onClick={triggerSimulatedError}
              className="rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/30 px-2 py-1 text-[10px] hover:bg-rose-500/20 font-semibold"
            >
              Error & Alert
            </button>
          </div>
        </div>

      </div>

    </div>
  );
};
