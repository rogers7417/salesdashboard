'use client';

import React from 'react';

type BadgeVariant = 'fill' | 'weak';
type BadgeSize = 'xsmall' | 'small' | 'medium' | 'large';
type BadgeColor = 'blue' | 'teal' | 'green' | 'red' | 'yellow' | 'elephant' | 'purple';

interface TossBadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  color?: BadgeColor;
  style?: React.CSSProperties;
}

const COLOR_MAP: Record<BadgeColor, { fill: { bg: string; color: string }; weak: { bg: string; color: string } }> = {
  blue: {
    fill: { bg: '#3182F6', color: '#FFFFFF' },
    weak: { bg: '#D6EAFF', color: '#1A6AD6' },
  },
  teal: {
    fill: { bg: '#00B8D9', color: '#FFFFFF' },
    weak: { bg: '#D0F4F8', color: '#007A8A' },
  },
  green: {
    fill: { bg: '#20C997', color: '#FFFFFF' },
    weak: { bg: '#D4F5E0', color: '#0A8F5E' },
  },
  red: {
    fill: { bg: '#F04452', color: '#FFFFFF' },
    weak: { bg: '#FFE0E3', color: '#D32F3F' },
  },
  yellow: {
    fill: { bg: '#FFC426', color: '#191F28' },
    weak: { bg: '#FFEFC2', color: '#8A6400' },
  },
  elephant: {
    fill: { bg: '#6B7684', color: '#FFFFFF' },
    weak: { bg: '#E8EBED', color: '#4E5968' },
  },
  purple: {
    fill: { bg: '#8B5CF6', color: '#FFFFFF' },
    weak: { bg: '#F3F0FF', color: '#6D28D9' },
  },
};

const SIZE_MAP: Record<BadgeSize, { padding: string; fontSize: string; borderRadius: string; lineHeight: string }> = {
  xsmall: { padding: '3px 8px', fontSize: '15px', borderRadius: '8px', lineHeight: '1.4' },
  small: { padding: '4px 10px', fontSize: '16px', borderRadius: '10px', lineHeight: '1.4' },
  medium: { padding: '5px 12px', fontSize: '17px', borderRadius: '10px', lineHeight: '1.5' },
  large: { padding: '6px 14px', fontSize: '18px', borderRadius: '12px', lineHeight: '1.5' },
};

export default function TossBadge({
  children,
  variant = 'fill',
  size = 'small',
  color = 'blue',
  style,
}: TossBadgeProps) {
  const colorStyle = COLOR_MAP[color]?.[variant] ?? COLOR_MAP.elephant[variant];
  const sizeStyle = SIZE_MAP[size];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: sizeStyle.padding,
        fontSize: sizeStyle.fontSize,
        borderRadius: sizeStyle.borderRadius,
        lineHeight: sizeStyle.lineHeight,
        fontWeight: 600,
        backgroundColor: colorStyle.bg,
        color: colorStyle.color,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
