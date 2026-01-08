import React, { useEffect } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, Tabs, router, usePathname } from 'expo-router';
import { Pressable, useColorScheme, Platform, StyleSheet, View, Text } from 'react-native';

import Colors from '../../constants/Colors';

/**
 * You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
 */
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const pathname = usePathname();

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

const styles = StyleSheet.create({
  headerLogo: {
    width: 34,
    height: 34,
    marginRight: 8,
  },
});
