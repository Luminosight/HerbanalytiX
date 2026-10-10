import Header from '@/src/components/Header';
import { PlantConfigProvider } from '@/src/context/PlantConfigContext';
import { SensorProvider, useSensor } from '@/src/context/SensorContext';
import { useTheme } from '@/src/theme/ThemeContext';
import { Tabs } from 'expo-router';
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

const icons = {
  home: require('@/assets/icons/home.png'),
  history: require('@/assets/icons/history.png'),
  settings: require('@/assets/icons/settings.png'),
};

// Simple camera icon component (no image file needed)
function CameraIcon({ focused, color }: { focused: boolean; color: string }) {
  const theme = useTheme();
  return (
    <View style={[
      styles.tabIcon,
      focused && {
        backgroundColor: theme.isDark
          ? 'rgba(116, 198, 157, 0.2)'
          : 'rgba(45, 106, 79, 0.12)',
      },
    ]}>
      <View style={{
        width: 20, height: 16, borderRadius: 3,
        borderWidth: 2, borderColor: focused ? theme.primary : theme.textMuted,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <View style={{
          width: 7, height: 7, borderRadius: 4,
          borderWidth: 1.5, borderColor: focused ? theme.primary : theme.textMuted,
        }} />
      </View>
    </View>
  );
}

// Water-drop icon for Reservoir tab
function ReservoirIcon({ focused }: { focused: boolean }) {
  const theme = useTheme();
  const color = focused ? theme.primary : theme.textMuted;
  return (
    <View style={[
      styles.tabIcon,
      focused && {
        backgroundColor: theme.isDark
          ? 'rgba(116, 198, 157, 0.2)'
          : 'rgba(45, 106, 79, 0.12)',
      },
    ]}>
      <View style={{
        width: 14, height: 18, borderRadius: 7,
        borderWidth: 2, borderColor: color,
        borderTopLeftRadius: 2, borderTopRightRadius: 2,
      }} />
    </View>
  );
}

function TabIcon({ source, focused }) {
  const theme = useTheme();
  return (
    <View style={[
      styles.tabIcon,
      focused && {
        backgroundColor: theme.isDark
          ? 'rgba(116, 198, 157, 0.2)'
          : 'rgba(45, 106, 79, 0.12)',
      },
    ]}>
      <Image
        source={source}
        style={[styles.icon, { tintColor: focused ? theme.primary : theme.textMuted }]}
        resizeMode="contain"
      />
    </View>
  );
}

function TabsInner() {
  const { data, connected } = useSensor();
  const theme = useTheme();

  return (
    <>
      <Header status={connected ? 'Online' : 'Offline'} />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: theme.tabBar,
            borderTopWidth: 1,
            borderTopColor: theme.tabBorder,
            height: 65,
            paddingBottom: 8,
            paddingTop: 6,
          },
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.textMuted,
          tabBarLabelStyle: styles.tabLabel,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ focused }) => <TabIcon source={icons.home} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: 'History',
            tabBarIcon: ({ focused }) => <TabIcon source={icons.history} focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="camera"
          options={{
            title: 'Vision',
            tabBarIcon: ({ focused }) => <CameraIcon focused={focused} color="" />,
          }}
        />
        <Tabs.Screen
          name="reservoir"
          options={{
            title: 'Reservoir',
            tabBarIcon: ({ focused }) => <ReservoirIcon focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ focused }) => <TabIcon source={icons.settings} focused={focused} />,
          }}
        />
      </Tabs>
    </>
  );
}

export default function TabLayout() {
  return (
    <PlantConfigProvider>
      <SensorProvider>
        <TabsInner />
      </SensorProvider>
    </PlantConfigProvider>
  );
}

const styles = StyleSheet.create({
  tabLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  tabIcon: {
    width: 40, height: 32,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 12,
  },
  icon: { width: 22, height: 22 },
});