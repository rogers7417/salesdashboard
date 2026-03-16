'use client';

import React from 'react';
import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  PieChart,
  Pie,
} from 'recharts';

// ============ Design Tokens (Toss-style) ============

const COLORS = {
  text: '#191F28',
  secondary: '#6B7684',
  muted: '#8B95A1',
  border: '#E5E8EB',
  bg: '#FFFFFF',
  bgSub: '#F9FAFB',
  green: '#00C950',
  red: '#F04452',
  blue: '#3182F6',
  orange: '#F59E0B',
  teal: '#0EA5E9',
  purple: '#8B5CF6',
};

const DEFAULT_PIE_COLORS = [
  '#3182F6', '#00C950', '#F59E0B', '#F04452',
  '#8B5CF6', '#0EA5E9', '#EC4899', '#6B7684',
];

// ============ KPICard ============

interface KPICardProps {
  label: string;
  value: string | number;
  unit?: string;
  prevValue?: number;
  target?: number | string;
  targetLabel?: string;
  color?: string;
}

export function KPICard({
  label,
  value,
  unit,
  prevValue,
  target,
  targetLabel,
  color = COLORS.blue,
}: KPICardProps) {
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  const delta =
    prevValue !== undefined && prevValue !== 0 && !isNaN(numericValue)
      ? ((numericValue - prevValue) / Math.abs(prevValue)) * 100
      : null;

  return (
    <div
      style={{
        background: COLORS.bg,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: '20px 24px',
        minWidth: 160,
        flex: 1,
      }}
    >
      <div style={{ fontSize: 13, color: COLORS.secondary, marginBottom: 8, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: COLORS.text }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 14, color: COLORS.secondary, fontWeight: 500 }}>{unit}</span>
        )}
        {delta !== null && <DeltaBadge current={numericValue} previous={prevValue!} />}
      </div>
      {target !== undefined && (
        <div
          style={{
            marginTop: 8,
            display: 'inline-block',
            fontSize: 12,
            fontWeight: 600,
            color: color,
            background: `${color}14`,
            borderRadius: 6,
            padding: '2px 8px',
          }}
        >
          {targetLabel || 'Target'}: {target}
        </div>
      )}
    </div>
  );
}

// ============ DeltaBadge ============

interface DeltaBadgeProps {
  current: number;
  previous: number;
}

export function DeltaBadge({ current, previous }: DeltaBadgeProps) {
  if (previous === 0 || previous === undefined || previous === null) return null;

  const delta = ((current - previous) / Math.abs(previous)) * 100;
  const isPositive = delta > 0;
  const isZero = delta === 0;
  const arrow = isPositive ? '\u25B2' : '\u25BC';
  const color = isZero ? COLORS.secondary : isPositive ? COLORS.green : COLORS.red;

  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        color,
        marginLeft: 4,
        whiteSpace: 'nowrap',
      }}
    >
      {isZero ? '0%' : `${arrow} ${Math.abs(delta).toFixed(1)}%`}
    </span>
  );
}

// ============ TrendChart ============

interface BarDef {
  key: string;
  color: string;
  name: string;
}

interface LineDef {
  key: string;
  color: string;
  name: string;
  yAxisId?: string;
}

interface TrendChartProps {
  data: any[];
  bars: BarDef[];
  lines?: LineDef[];
  height?: number;
  referenceLine?: { y: number; label?: string; color?: string };
}

export function TrendChart({
  data,
  bars,
  lines = [],
  height = 320,
  referenceLine,
}: TrendChartProps) {
  const hasRightAxis = lines.some((l) => l.yAxisId === 'right');

  return (
    <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20 }}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: COLORS.secondary }}
            tickLine={false}
            axisLine={{ stroke: COLORS.border }}
            tickFormatter={(v: string) => {
              if (!v) return '';
              const parts = v.split('-');
              return parts.length >= 3 ? `${parseInt(parts[1])}/${parseInt(parts[2])}` : v;
            }}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 12, fill: COLORS.secondary }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          {hasRightAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 12, fill: COLORS.secondary }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => `${v}%`}
            />
          )}
          <Tooltip
            contentStyle={{
              background: COLORS.bg,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              fontSize: 13,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: COLORS.secondary, paddingTop: 8 }}
          />
          {bars.map((b) => (
            <Bar
              key={b.key}
              dataKey={b.key}
              name={b.name}
              fill={b.color}
              yAxisId="left"
              radius={[4, 4, 0, 0]}
              barSize={24}
            />
          ))}
          {lines.map((l) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.name}
              stroke={l.color}
              yAxisId={l.yAxisId || 'left'}
              strokeWidth={2}
              dot={{ r: 3, fill: l.color }}
              activeDot={{ r: 5 }}
            />
          ))}
          {referenceLine && (
            <ReferenceLine
              y={referenceLine.y}
              yAxisId="left"
              stroke={referenceLine.color || COLORS.red}
              strokeDasharray="6 4"
              label={{
                value: referenceLine.label || '',
                position: 'insideTopRight',
                fontSize: 11,
                fill: referenceLine.color || COLORS.red,
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============ OwnerBarChart ============

interface OwnerBarChartProps {
  data: any[];
  bars: BarDef[];
  stacked?: boolean;
  height?: number;
  nameKey?: string;
}

export function OwnerBarChart({
  data,
  bars,
  stacked = false,
  height = 320,
  nameKey = 'name',
}: OwnerBarChartProps) {
  return (
    <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20 }}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
          <XAxis
            dataKey={nameKey}
            tick={{ fontSize: 12, fill: COLORS.secondary }}
            tickLine={false}
            axisLine={{ stroke: COLORS.border }}
          />
          <YAxis
            tick={{ fontSize: 12, fill: COLORS.secondary }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: COLORS.bg,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              fontSize: 13,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: COLORS.secondary, paddingTop: 8 }}
          />
          {bars.map((b) => (
            <Bar
              key={b.key}
              dataKey={b.key}
              name={b.name}
              fill={b.color}
              stackId={stacked ? 'stack' : undefined}
              radius={stacked ? undefined : [4, 4, 0, 0]}
              barSize={stacked ? 32 : 24}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============ FunnelChart ============

interface FunnelStep {
  label: string;
  value: number;
  color: string;
}

interface FunnelChartProps {
  steps: FunnelStep[];
}

export function FunnelChart({ steps }: FunnelChartProps) {
  if (!steps || steps.length === 0) return null;

  const maxValue = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24 }}>
      {steps.map((step, i) => {
        const widthPct = Math.max((step.value / maxValue) * 100, 12);
        const prevValue = i > 0 ? steps[i - 1].value : null;
        const conversionRate =
          prevValue && prevValue > 0 ? ((step.value / prevValue) * 100).toFixed(1) : null;

        return (
          <div key={step.label}>
            {i > 0 && conversionRate && (
              <div
                style={{
                  textAlign: 'center',
                  fontSize: 11,
                  color: COLORS.muted,
                  padding: '4px 0',
                  fontWeight: 500,
                }}
              >
                {'\u25BC'} {conversionRate}%
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <div
                style={{
                  width: 100,
                  fontSize: 13,
                  fontWeight: 500,
                  color: COLORS.text,
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                {step.label}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    width: `${widthPct}%`,
                    background: step.color,
                    borderRadius: 6,
                    padding: '8px 12px',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 700,
                    minWidth: 48,
                    textAlign: 'right',
                    transition: 'width 0.4s ease',
                  }}
                >
                  {step.value.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============ AgingPieChart ============

interface AgingPieChartProps {
  data: Record<string, number>;
  colors?: string[];
}

export function AgingPieChart({ data, colors = DEFAULT_PIE_COLORS }: AgingPieChartProps) {
  if (!data || Object.keys(data).length === 0) return null;

  const chartData = Object.entries(data).map(([name, value]) => ({ name, value }));
  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <ResponsiveContainer width={200} height={200}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={85}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((_, idx) => (
                <Cell key={idx} fill={colors[idx % colors.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: COLORS.bg,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                fontSize: 13,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}
              formatter={(value: number) => [value.toLocaleString(), '']}
            />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {chartData.map((d, idx) => {
            const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
            return (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: colors[idx % colors.length],
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, color: COLORS.text, flex: 1 }}>{d.name}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
                  {d.value.toLocaleString()}
                </span>
                <span style={{ fontSize: 12, color: COLORS.muted, width: 40, textAlign: 'right' }}>
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============ HorizontalBarChart ============

interface HorizontalBarChartProps {
  data: { name: string; value: number }[];
  color?: string;
}

export function HorizontalBarChart({
  data,
  color = COLORS.blue,
}: HorizontalBarChartProps) {
  if (!data || data.length === 0) return null;

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.map((item) => {
          const widthPct = Math.max((item.value / maxValue) * 100, 4);
          return (
            <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 120,
                  fontSize: 13,
                  fontWeight: 500,
                  color: COLORS.text,
                  textAlign: 'right',
                  flexShrink: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={item.name}
              >
                {item.name}
              </div>
              <div style={{ flex: 1, background: COLORS.bgSub, borderRadius: 6, height: 28 }}>
                <div
                  style={{
                    width: `${widthPct}%`,
                    background: color,
                    borderRadius: 6,
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    paddingRight: 8,
                    transition: 'width 0.4s ease',
                    minWidth: 32,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
                    {item.value.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
