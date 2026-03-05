import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  SectionList,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import DAppConnectionStore, { DAppConnectionRecord } from '../services/DAppConnectionStore';
import NativeBridge from '../services/NativeBridge';

function formatDate(ts: number): string {
  const d = new Date(ts);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function truncateAddress(address: string): string {
  if (!address || address.length < 14) return address || 'None';
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.port ? `:${u.port}` : '');
  } catch {
    return url;
  }
}

/** Animated pulsing dot for connection status */
const PulsingDot = ({ active }: { active: boolean }) => {
  const color = active ? '#3b82f6' : '#6b7280'; // blue-500 / gray-500
  return (
    <View style={[pulseStyles.container, { backgroundColor: `${color}40` }]}>
      {active && (
        <View style={[pulseStyles.ping, { backgroundColor: color }]} />
      )}
      <View style={[pulseStyles.dot, { backgroundColor: active ? `${color}e6` : `${color}99` }]} />
    </View>
  );
};

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
    opacity: 0.3,
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
  onAction: (channelId: string, isActive: boolean) => void;
}

const ConnectionRow = ({ record, onAction }: ConnectionRowProps) => {
  const isActive = record.disconnectedAt === null;

  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <View style={styles.rowHeader}>
          <PulsingDot active={isActive} />
          <Text style={styles.dappName} numberOfLines={1}>{record.name}</Text>
        </View>
        <Text style={styles.dappUrl} numberOfLines={1}>
          {truncateUrl(record.url)}
          {record.connectedAccount ? ` · ${truncateAddress(record.connectedAccount)}` : ''}
        </Text>
        <Text style={styles.dateText}>
          {isActive ? 'Connected' : 'Disconnected'} {formatDate(isActive ? record.connectedAt : record.disconnectedAt!)}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.actionButton, isActive ? styles.disconnectButton : styles.removeButton]}
        onPress={() => onAction(record.channelId, isActive)}
      >
        <Text style={[styles.actionText, isActive ? styles.disconnectText : styles.removeText]}>
          {isActive ? 'Disconnect' : 'Remove'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

export default function DAppConnectionsScreen() {
  const navigation = useNavigation();
  const [active, setActive] = useState<DAppConnectionRecord[]>([]);
  const [recent, setRecent] = useState<DAppConnectionRecord[]>([]);

  const loadConnections = useCallback(async () => {
    const activeRecords = await DAppConnectionStore.getActive();
    const recentRecords = await DAppConnectionStore.getRecent();
    setActive(activeRecords);
    setRecent(recentRecords);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadConnections();
    }, [loadConnections])
  );

  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <FontAwesome name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

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
              // Tell WebView to disconnect the relay session
              NativeBridge.sendDAppDisconnect(channelId);
              // Mark as disconnected in native store
              await DAppConnectionStore.onDisconnected(channelId, true);
              loadConnections();
            },
          },
        ]
      );
    } else {
      DAppConnectionStore.remove(channelId).then(() => loadConnections());
    }
  };

  const sections = [];
  if (active.length > 0) {
    sections.push({ title: 'Active', data: active });
  }
  if (recent.length > 0) {
    sections.push({ title: 'Recent', data: recent });
  }

  const isEmpty = active.length === 0 && recent.length === 0;

  return (
    <View style={styles.container}>
      {isEmpty ? (
        <View style={styles.emptyContainer}>
          <FontAwesome name="plug" size={48} color="#3a3a4a" />
          <Text style={styles.emptyTitle}>No dApp Connections</Text>
          <Text style={styles.emptyText}>
            Scan a QR code from a dApp to connect your wallet.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.channelId}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionTitle}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <ConnectionRow record={item} onAction={handleAction} />
          )}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A17',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3b82f6',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 10,
    paddingLeft: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16161a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  rowLeft: {
    flex: 1,
    marginRight: 12,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  dappName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f8fafc',
    flexShrink: 1,
  },
  dappUrl: {
    fontSize: 13,
    color: '#888',
    marginBottom: 2,
  },
  dateText: {
    fontSize: 12,
    color: '#666',
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  disconnectButton: {
    borderColor: '#ef444444',
    backgroundColor: '#ef444411',
  },
  removeButton: {
    borderColor: '#6b728044',
    backgroundColor: '#6b728011',
  },
  actionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  disconnectText: {
    color: '#ef4444',
  },
  removeText: {
    color: '#6b7280',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#f8fafc',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
  backButton: {
    padding: 10,
  },
});
