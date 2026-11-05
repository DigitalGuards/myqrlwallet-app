import { t } from '../i18n';
import { useNativeLanguage } from '../i18n/useNativeLanguage';
import { Link, Stack } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

export default function NotFoundScreen() {
  useNativeLanguage();
  return (
    <>
      <Stack.Screen options={{ title: t('navigation.oops') }} />
      <ThemedView style={styles.container}>
        <ThemedText type="title">{t('navigation.missing')}</ThemedText>
        <Link href="/" style={styles.link}>
          <ThemedText type="link">{t('navigation.home')}</ThemedText>
        </Link>
      </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
});
