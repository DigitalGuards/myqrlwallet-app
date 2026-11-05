import { t } from '../../i18n';
import { useNativeLanguage } from '../../i18n/useNativeLanguage';
import { Tabs } from 'expo-router';

export default function TabLayout() {
  useNativeLanguage();
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          display: 'none', // Hide the tab bar completely
        },
        headerShown: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('navigation.wallet'),
        }}
      />
    </Tabs>
  );
}
