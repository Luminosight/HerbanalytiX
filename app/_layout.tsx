import OnboardingScreen from '@/src/screens/OnboardingScreen';
import { ThemeProvider } from '@/src/theme/ThemeContext';
import { setResetCallback } from '@/src/utils/resetStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';

const ONBOARDING_KEY = '@herbanalytix:onboardingDone';

export default function RootLayout() {
  // null = still loading from storage; false = show onboarding; true = skip
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  // Load persisted flag on mount
  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then((val) => {
      setOnboardingDone(val === 'true');
    });
  }, []);

  // Wire up the reset callback to clear the flag and re-show onboarding
  useEffect(() => {
    setResetCallback(async () => {
      await AsyncStorage.removeItem(ONBOARDING_KEY);
      setOnboardingDone(false);
    });
    return () => setResetCallback(null);
  }, []);

  const handleOnboardingDone = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setOnboardingDone(true);
  };

  // Still reading from storage — render nothing (splash screen covers it)
  if (onboardingDone === null) return null;

  if (!onboardingDone) {
    return (
      <ThemeProvider>
        <OnboardingScreen onDone={handleOnboardingDone} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}