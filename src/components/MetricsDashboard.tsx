import React, { useState } from 'react';
import {
  BarChart3,
  Cpu,
  HardDrive,
  Activity,
  Server,
} from 'lucide-react';
import { useHub } from '../context/HubContext';
import { MetricDataPoint } from '../types';
import { ServiceIcon, isIconUrl } from './ServiceIcon';

export const MetricsDashboard: React.FC = () => {
  const { allServices, accounts, activeAccountId } = useHub();
  const [selectedServiceId, setSelectedServiceId] = useState<string>(allServices[0]?.id || 'all');

  const activeServices = allServices.filter(
    (s) => activeAccountId === 'all' || s.accountId === activeAccountId
  );

  const currentService = allServices.find((s) => s.id === selectedServiceId) || allServices[0];

  // Helper to render responsive SVG area/line chart
  const renderAreaChart = (
    data: MetricDataPoint[],
    dataKey: 'cpu' | 'memory' | 'requests',
    color: string,
    maxValue: number,
    unit: string
  ) => {
    if (!data || data.length === 0) {
      return (
        <div className="flex h-36 sm:h-40 items-center justify-center text-xs text-neutral-500">
          در حال دریافت داده‌های تله‌متری...
        </div>
      );
    }

    const width = 600;
    const height = 140;
    const padding = 15;

    const points = data.map((d, i) => {
      const x = padding + (i / Math.max(1, data.length - 1)) * (width - padding * 2);
      const val = d[dataKey] || 0;
      const y = height - padding - (val / maxValue) * (height - padding * 2);
      return { x, y, val, time: d.time };
    });

    const pathD = points.reduce((acc, p, i) => {
      return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, '');

    const areaD = `${pathD} L ${points[points.length - 1]?.x} ${height - padding} L ${points[0]?.x} ${height - padding} Z`;

    const latestVal = points[points.length - 1]?.val || 0;

    return (
      <div className="relative w-full max-w-full overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-neutral-400">مقدار لحظه‌ای</span>
          <span className="font-mono text-base sm:text-lg font-bold text-white">
            {latestVal}
            <span className="text-xs font-normal text-neutral-400 mr-1">{unit}</span>
          </span>
        </div>

        <div className="w-full overflow-hidden">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32 sm:h-36 overflow-hidden">
            <defs>
              <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.4" />
                <stop offset="100%" stopColor={color} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            <line
              x1={padding}
              y1={padding}
              x2={width - padding}
              y2={padding}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="4 4"
            />
            <line
              x1={padding}
              y1={height / 2}
              x2={width - padding}
              y2={height / 2}
              stroke="rgba(255,255,255,0.06)"
              strokeDasharray="4 4"
            />
            <line
              x1={padding}
              y1={height - padding}
              x2={width - padding}
              y2={height - padding}
              stroke="rgba(255,255,255,0.12)"
            />

            {/* Filled Area */}
            <path d={areaD} fill={`url(#grad-${dataKey})`} />

            {/* Curve Line */}
            <path
              d={pathD}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Current pulse dot */}
            {points.length > 0 && (
              <g transform={`translate(${points[points.length - 1].x}, ${points[points.length - 1].y})`}>
                <circle r="4" fill={color} />
                <circle r="3" fill="#ffffff" stroke={color} strokeWidth="1.5" />
              </g>
            )}
          </svg>
        </div>

        {/* Timestamps row */}
        <div className="flex items-center justify-between text-[9px] sm:text-[10px] text-neutral-500 font-mono mt-1">
          <span>{points[0]?.time}</span>
          <span>{points[Math.floor(points.length / 2)]?.time}</span>
          <span>{points[points.length - 1]?.time} (الان)</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 pb-20 lg:pb-8 w-full max-w-full overflow-hidden">
      
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-base sm:text-xl font-black text-white flex items-center gap-2">
            <BarChart3 className="h-5 w-5 sm:h-6 sm:w-6 text-purple-400 shrink-0" />
            <span>گزارش و نمودارهای مصرف منابع نودها</span>
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            پایش لحظه‌ای مصرف پردازنده، حافظه رم و درخواست‌های ورودی به کانتینرها
          </p>
        </div>

        {/* Node selector dropdown */}
        <div className="w-full sm:w-auto">
          <select
            value={selectedServiceId}
            onChange={(e) => setSelectedServiceId(e.target.value)}
            className="w-full sm:w-auto rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-semibold text-white focus:border-purple-500 focus:outline-none cursor-pointer"
          >
            {activeServices.map((srv) => (
              <option key={srv.id} value={srv.id}>
                {isIconUrl(srv.icon) ? '🖼' : srv.icon || '⚡'} {srv.name} ({srv.region})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Primary Metrics Charts Grid */}
      {currentService && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 max-w-full overflow-hidden">
          
          {/* Chart 1: CPU Utilization */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 backdrop-blur-md max-w-full overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 shrink-0">
                  <Cpu className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-bold text-white truncate">مصرف پردازنده (CPU)</h3>
                  <span className="text-[10px] text-neutral-400 truncate block">{currentService.name}</span>
                </div>
              </div>

              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-mono text-neutral-300 shrink-0">
                Max: 100%
              </span>
            </div>

            {renderAreaChart(
              currentService.historyMetrics || [],
              'cpu',
              '#A855F7',
              100,
              '%'
            )}
          </div>

          {/* Chart 2: Memory (RAM) Usage */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 backdrop-blur-md max-w-full overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 shrink-0">
                  <HardDrive className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-bold text-white truncate">مصرف حافظه (RAM)</h3>
                  <span className="text-[10px] text-neutral-400 truncate block">
                    سقف: {currentService.memoryLimit} MB
                  </span>
                </div>
              </div>

              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-mono text-neutral-300 shrink-0">
                {currentService.memoryLimit}MB
              </span>
            </div>

            {renderAreaChart(
              currentService.historyMetrics || [],
              'memory',
              '#6366F1',
              currentService.memoryLimit || 512,
              'MB'
            )}
          </div>

          {/* Chart 3: Requests / Second */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 backdrop-blur-md max-w-full overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0">
                  <Activity className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-bold text-white truncate">درخواست‌های ورودی (Req / sec)</h3>
                  <span className="text-[10px] text-neutral-400">ترافیک لایو HTTP</span>
                </div>
              </div>
            </div>

            {renderAreaChart(
              currentService.historyMetrics || [],
              'requests',
              '#10B981',
              60,
              'req/s'
            )}
          </div>

          {/* Summary Box: Node Hardware Spec */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 sm:p-5 backdrop-blur-md flex flex-col justify-between max-w-full overflow-hidden">
            <div>
              <div className="flex items-center gap-2 border-b border-neutral-800/80 pb-2.5 mb-3">
                <Server className="h-4 w-4 text-purple-400 shrink-0" />
                <h3 className="text-xs font-bold text-white truncate">تخصیص منابع نود</h3>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-neutral-950 p-2.5 border border-neutral-800 min-w-0">
                  <span className="text-neutral-500 text-[10px] block">ایمیج / کانتینر</span>
                  <span className="font-mono text-white font-bold mt-0.5 block truncate text-[11px]">
                    {currentService.imageOrRepo}
                  </span>
                </div>

                <div className="rounded-xl bg-neutral-950 p-2.5 border border-neutral-800 min-w-0">
                  <span className="text-neutral-500 text-[10px] block">دیتاسنتر</span>
                  <span className="font-mono text-white font-bold mt-0.5 block text-[11px] truncate">
                    {currentService.region}
                  </span>
                </div>

                <div className="rounded-xl bg-neutral-950 p-2.5 border border-neutral-800 min-w-0">
                  <span className="text-neutral-500 text-[10px] block">ترافیک ورودی</span>
                  <span className="font-mono text-emerald-400 font-bold mt-0.5 block text-[11px]">
                    {(currentService.networkIn / 1024).toFixed(2)} GB
                  </span>
                </div>

                <div className="rounded-xl bg-neutral-950 p-2.5 border border-neutral-800 min-w-0">
                  <span className="text-neutral-500 text-[10px] block">ترافیک خروجی</span>
                  <span className="font-mono text-sky-400 font-bold mt-0.5 block text-[11px]">
                    {(currentService.networkOut / 1024).toFixed(2)} GB
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-neutral-800/80 text-[10px] sm:text-[11px] text-neutral-400 flex items-center justify-between">
              <span>ری‌استارت: {currentService.restartsCount}</span>
              <span className="text-emerald-400 font-medium">آپتایم: 99.98%</span>
            </div>
          </div>

        </div>
      )}

      {/* Comparison Table for All Active Nodes */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3.5 sm:p-5 backdrop-blur-md max-w-full overflow-hidden">
        <h3 className="text-xs sm:text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-purple-400 shrink-0" />
          <span>جدول مقایسه مصرف لحظه‌ای نودها</span>
        </h3>

        <div className="w-full overflow-x-auto">
          <table className="w-full text-right text-xs min-w-[500px]">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-400 text-[11px]">
                <th className="pb-2.5 pr-2">نام نود / سرویس</th>
                <th className="pb-2.5 px-2">اکانت</th>
                <th className="pb-2.5 px-2">وضعیت</th>
                <th className="pb-2.5 px-2">پردازنده</th>
                <th className="pb-2.5 px-2">حافظه</th>
                <th className="pb-2.5 px-2">ریجن</th>
                <th className="pb-2.5 pl-2">آپتایم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60">
              {allServices.map((s) => {
                const acc = accounts.find((a) => a.id === s.accountId);
                return (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedServiceId(s.id)}
                    className="hover:bg-neutral-800/40 cursor-pointer transition"
                  >
                    <td className="py-2.5 pr-2 font-bold text-white flex items-center gap-1.5">
                      <ServiceIcon icon={s.icon} alt={s.name} />
                      <span className="truncate max-w-[110px]">{s.name}</span>
                    </td>
                    <td className="py-2.5 px-2 text-neutral-400 truncate max-w-[90px]">{acc?.name}</td>
                    <td className="py-2.5 px-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                          s.status === 'healthy'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : s.status === 'stopped'
                            ? 'bg-neutral-800 text-neutral-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}
                      >
                        {s.status === 'healthy' ? 'آنلاین' : s.status === 'stopped' ? 'متوقف' : 'خطا'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 font-mono text-purple-300 font-semibold">{s.cpuUsage}%</td>
                    <td className="py-2.5 px-2 font-mono text-indigo-300 font-semibold">
                      {s.memoryUsage}MB
                    </td>
                    <td className="py-2.5 px-2 text-neutral-400 font-mono text-[10px] truncate max-w-[80px]">{s.region}</td>
                    <td className="py-2.5 pl-2 text-neutral-400 font-mono text-[10px]">{s.uptime}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
