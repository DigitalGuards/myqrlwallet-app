import { ComponentProps, ReactNode } from 'react';
import { Pressable } from 'react-native';
import { openBrowserAsync } from 'expo-web-browser';
import { Platform } from 'react-native';

// Define props separately from Link component to avoid type conflicts
type ExternalLinkProps = {
  href: string;
  children: ReactNode;
  style?: ComponentProps<typeof Pressable>['style'];
};

export function ExternalLink({ href, children, style }: ExternalLinkProps) {
  const handlePress = async () => {
    // On native, use openBrowserAsync to open external links
    if (Platform.OS !== 'web') {
      await openBrowserAsync(href);
    } else {
      // On web, open in a new tab
      window.open(href, '_blank');
    }
  };

  return (
    <Pressable onPress={handlePress} style={style}>
      {children}
    </Pressable>
  );
}
