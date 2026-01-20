import React from 'react';
import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        tabBarStyle: { 
          display: 'none', // Hide the tab bar completely
        },
        headerShown: route.name === 'settings', // Only show header on settings page
        headerStyle: {
          backgroundColor: '#0A0A17',
          shadowColor: 'transparent',
          elevation: 0,
        },
        headerLeftContainerStyle: {
          paddingLeft: 8,
        },
        headerTitleStyle: {
          fontWeight: 'bold',
          color: '#fff',
          fontSize: 18,
        },
        headerTitleAlign: 'center',
        headerShadowVisible: false,
      })}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'QRL Wallet',
          headerShown: false, // Hide header on main wallet screen
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          headerTitle: 'Settings',
        }}
      />
      {/* Remove the other tab screens */}
    </Tabs>
  );
}
