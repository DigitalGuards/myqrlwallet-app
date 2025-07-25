import { ComponentProps, ReactNode } from 'react';
import { Pressable } from 'react-native';
import { Linking, Platform } from 'react-native';

// Define props separately from Link component to avoid type conflicts
type ExternalLinkProps = {
  href: string;
  children: ReactNode;
  style?: ComponentProps<typeof Pressable>['style'];
};

export function ExternalLink({ href, children, style }: ExternalLinkProps) {
  const handlePress = async () => {
    // Use Linking API for all platforms
    if (Platform.OS !== 'web') {
      await Linking.openURL(href);
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
