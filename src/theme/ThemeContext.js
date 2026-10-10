import React, { createContext, useContext, useState } from 'react';

const dark = {
  bgDark: '#061410',
  bgGradientTop: '#0A1F14',
  bgGradientBot: '#0D2818',
  glassDark: 'rgba(13, 40, 24, 0.6)',
  glassMid: 'rgba(26, 61, 43, 0.45)',
  glassLight: 'rgba(116, 198, 157, 0.15)',
  glassWhite: 'rgba(255, 255, 255, 0.08)',
  glassBorder: 'rgba(116, 198, 157, 0.25)',
  glassBorderLight: 'rgba(255, 255, 255, 0.15)',
  textPrimary: '#ECFDF5',
  textSecondary: 'rgba(236, 253, 245, 0.65)',
  textMuted: 'rgba(236, 253, 245, 0.35)',
  tabBar: '#061410',
  tabBorder: 'rgba(116, 198, 157, 0.25)',
  headerBg: 'rgba(13, 40, 24, 0.85)',
  headerBorder: 'rgba(116, 198, 157, 0.25)',
  cardBg: ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.03)'],
  cardBorder: 'rgba(255,255,255,0.1)',
  sectionCardBg: 'rgba(255,255,255,0.05)',
  sectionCardBorder: 'rgba(255,255,255,0.08)',
  divider: 'rgba(255,255,255,0.05)',
  rowLabel: '#ECFDF5',
  rowSub: 'rgba(236, 253, 245, 0.35)',
  mistingText: '#4ADE80',
  statNum: '#74C69D',
  statusNormal: '#4ADE80',
  statusWarning: '#FBBF24',
  statusDanger: '#F87171',
};

const light = {
  bgDark: '#E8F5EE',
  bgGradientTop: '#C8E6D4',
  bgGradientBot: '#E0F2E9',
  glassDark: 'rgba(200, 230, 212, 0.6)',
  glassMid: 'rgba(180, 220, 200, 0.45)',
  glassLight: 'rgba(116, 198, 157, 0.2)',
  glassWhite: 'rgba(255, 255, 255, 0.5)',
  glassBorder: 'rgba(255, 255, 255, 0.7)',
  glassBorderLight: 'rgba(255, 255, 255, 0.8)',
  textPrimary: '#1A3D2B',
  textSecondary: 'rgba(26, 61, 43, 0.7)',
  textMuted: 'rgba(26, 61, 43, 0.4)',
  tabBar: '#C8E6D4',
  tabBorder: 'rgba(255,255,255,0.6)',
  headerBg: 'rgba(200, 230, 212, 0.92)',
  headerBorder: 'rgba(255,255,255,0.6)',
  cardBg: ['rgba(34,85,55,0.12)', 'rgba(34,85,55,0.06)'],
  cardBorder: 'rgba(34,85,55,0.2)',
  sectionCardBg: 'rgba(34, 85, 55, 0.12)',
  sectionCardBorder: 'rgba(34, 85, 55, 0.25)',
  divider: 'rgba(26,61,43,0.08)',
  rowLabel: '#1A3D2B',
  rowSub: 'rgba(26, 61, 43, 0.45)',
  mistingText: '#166534', 
  statNum: '#1A3D2B',
  statusNormal: '#166534',
  statusWarning: '#854D0E',
  statusDanger: '#991B1B',
};

const shared = {
  deepForest: '#0D2818',
  forest: '#1A3D2B',
  primary: '#2D6A4F',
  mid: '#40916C',
  light: '#74C69D',
  pale: '#B7E4C7',
  teal: '#52B788',
  mint: '#95D5B2',
  glow: 'rgba(116, 198, 157, 0.4)',
  online: '#4ADE80',
  offline: '#F87171',
  warning: '#FBBF24',
  info: '#60A5FA',
  purple: '#7C3AED',
  purpleLight: '#A78BFA',
};

export const PLANT_PHASES = [
  {
    id: 'seedling',
    label: 'Seedling',
    emoji: '🌱',
    description: 'Early germination stage',
    image: require('../../assets/images/Seedling.png'),
    imageSize: { width: 160, height: 251 },
  },
  {
    id: 'vegetative',
    label: 'Vegetative',
    emoji: '🌿',
    description: 'Vegetative growth stage',
    image: require('../../assets/images/Young.png'),
    imageSize: { width: 335, height: 332 },
  },
];

export const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(true);
  const [plantPhase, setPlantPhase] = useState('seedling');

  const toggleTheme = () => setIsDark(prev => !prev);

  const theme = {
    ...shared,
    ...(isDark ? dark : light),
    isDark,
    toggleTheme,
    plantPhase,
    setPlantPhase,
  };

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);