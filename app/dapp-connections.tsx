import React, { useState, useCallback, useLayoutEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DAppConnectionStore, { DAppConnectionRecord } from '../services/DAppConnectionStore';
import NativeBridge from '../services/NativeBridge';
import Logger from '../services/Logger';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const C = {
  bg: '#0f172a',
  card: '#1e293b',
  divider: '#334155',
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',
  chevron: '#64748b',
  brandOrange: '#ff8700',
  green: '#22c55e',
  red: '#ef4444',
  gray: '#64748b',
  blue: '#3b82f6',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function absoluteTime(ts: number): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const datePart = sameYear
    ? `${MONTHS[d.getMonth()]} ${d.getDate()}`
    : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${datePart} at ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relativeTime(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 45_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return absoluteTime(ts);
}

function truncateAddress(address: string): string {
  if (!address || address.length < 14) return address || '';
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function hostname(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.port ? `:${u.port}` : '');
  } catch {
    return url;
  }
}

/** Animated pulsing dot for live connections. */
function PulsingDot({ active }: { active: boolean }) {
  const color = active ? C.green : C.gray;
  return (
    <View style={[pulseStyles.container, { backgroundColor: `${color}33` }]}>
      {active && <View style={[pulseStyles.ping, { backgroundColor: color }]} />}
      <View style={[pulseStyles.dot, { backgroundColor: active ? color : `${color}bb` }]} />
    </View>
  );
}

const pulseStyles = StyleSheet.create({
  container: {
    width: 10,
    height: 10,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ping: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    opacity: 0.25,
  },
  dot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});

interface ConnectionRowProps {
  record: DAppConnectionRecord;
  now: number;
  onAction: (channelId: string, isActive: boolean) => void;
}

function ConnectionRow({ record, now, onAction }: ConnectionRowProps) {
  const isActive = record.disconnectedAt === null;
  const ts = isActive ? record.connectedAt : (record.disconnectedAt ?? record.connectedAt);
  const verb = isActive ? 'Connected' : 'Disconnected';
  const rel = relativeTime(ts, now);
  const abs = absoluteTime(ts);
  const tileColor = isActive ? C.green : C.gray;

  return (
    <View style={styles.row}>
      <View style={[styles.tile, { backgroundColor: tileColor }]}>
        <Ionicons name="link" size={18} color="#ffffff" />
      </View>
      <View style={styles.rowText}>
        <View style={styles.headerLine}>
          <PulsingDot active={isActive} />
          <Text style={styles.dappName} numberOfLines={1}>
            {record.name}
          </Text>
        </View>
        <Text style={styles.dappUrl} numberOfLines={1}>
          {hostname(record.url)}
          {record.connectedAccount ? ` · ${truncateAddress(record.connectedAccount)}` : ''}
        </Text>
        <Text style={styles.timestamp} numberOfLines={1}>
          {verb} {rel}
          {rel !== abs ? ` · ${abs}` : ''}
        </Text>
      </View>
      <TouchableOpacity
        activeOpacity={0.6}
        style={[styles.actionButton, isActive ? styles.disconnectButton : styles.removeButton]}
        onPress={() => onAction(record.channelId, isActive)}
      >
        <Text style={[styles.actionText, isActive ? styles.disconnectText : styles.removeText]}>
          {isActive ? 'Disconnect' : 'Remove'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <View style={styles.sectionWrap}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.card}>
        {items.map((child, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {child}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

export default function DAppConnectionsScreen() {
  const navigation = useNavigation();
  const [active, setActive] = useState<DAppConnectionRecord[]>([]);
  const [recent, setRecent] = useState<DAppConnectionRecord[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const loadConnections = useCallback(async () => {
    try {
      const [activeRecords, recentRecords] = await Promise.all([
        DAppConnectionStore.getActive(),
        DAppConnectionStore.getRecent(),
      ]);
      setActive(activeRecords);
      setRecent(recentRecords);
    } catch (err) {
      Logger.error('DAppConnections', 'Failed to load:', err);
      setActive([]);
      setRecent([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadConnections();
      setNow(Date.now());
      const id = setInterval(() => setNow(Date.now()), 30_000);
      return () => clearInterval(id);
    }, [loadConnections])
  );

  const handleAction = (channelId: string, isActive: boolean) => {
    if (isActive) {
      Alert.alert(
        'Disconnect dApp',
        'This will end the connection. The dApp will need to reconnect.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disconnect',
            style: 'destructive',
            onPress: async () => {
              try {
                NativeBridge.sendDAppDisconnect(channelId);
                await DAppConnectionStore.onDisconnected(channelId, true);
                await loadConnections();
              } catch (err) {
                Logger.error('DAppConnections', 'Failed to disconnect:', err);
                Alert.alert('Error', 'Failed to disconnect. Please try again.');
              }
            },
          },
        ]
      );
    } else {
      DAppConnectionStore.remove(channelId)
        .then(() => loadConnections())
        .catch((err) => {
          Logger.error('DAppConnections', 'Failed to remove:', err);
          Alert.alert('Error', 'Failed to remove connection. Please try again.');
        });
    }
  };

  const isEmpty = active.length === 0 && recent.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>dApp Connections</Text>
      </View>

      {isEmpty ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyTile, { backgroundColor: C.card }]}>
            <Ionicons name="link-outline" size={32} color={C.textSecondary} />
          </View>
          <Text style={styles.emptyTitle}>No dApp Connections</Text>
          <Text style={styles.emptyText}>Scan a QR code from a dApp to pair your wallet.</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Section title="Active">
            {active.map((r) => (
              <ConnectionRow key={r.channelId} record={r} now={now} onAction={handleAction} />
            ))}
          </Section>
          <Section title="Recent">
            {recent.map((r) => (
              <ConnectionRow key={r.channelId} record={r} now={now} onAction={handleAction} />
            ))}
          </Section>
          <View style={styles.footer} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: -6,
    marginBottom: 4,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 0.2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 12,
    paddingBottom: 32,
  },
  sectionWrap: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.textSecondary,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 72,
  },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  rowText: {
    flex: 1,
    marginRight: 10,
    justifyContent: 'center',
  },
  headerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dappName: {
    fontSize: 16,
    fontWeight: '500',
    color: C.textPrimary,
    flexShrink: 1,
  },
  dappUrl: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  timestamp: {
    fontSize: 11,
    color: C.textTertiary,
    marginTop: 3,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.divider,
    marginLeft: 60,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  disconnectButton: {
    borderColor: `${C.red}55`,
    backgroundColor: `${C.red}14`,
  },
  removeButton: {
    borderColor: `${C.gray}55`,
    backgroundColor: `${C.gray}14`,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  disconnectText: {
    color: C.red,
  },
  removeText: {
    color: C.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTile: {
    width: 64,
    height: 64,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: C.textPrimary,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  footer: {
    height: 24,
  },
});
