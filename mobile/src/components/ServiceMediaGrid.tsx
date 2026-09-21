import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Modal, Pressable, Linking, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fmtDate } from '../lib/theme';
import { ServiceMediaItem, MEDIA_LABEL_TEXT } from '../lib/types';

interface Props {
  items: ServiceMediaItem[];
  /** Dark background (customer portal). */
  dark?: boolean;
  /** Office controls: hide/show for the customer, delete. */
  onToggleHidden?: (item: ServiceMediaItem) => void;
  onDelete?: (item: ServiceMediaItem) => void;
}

function fmtTaken(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Photo/video thumbnails from a service visit. Images open full screen;
 * videos open in the phone's player through the signed link.
 */
export function ServiceMediaGrid({ items, dark, onToggleHidden, onDelete }: Props) {
  const [open, setOpen] = useState<ServiceMediaItem | null>(null);
  const openItem = (item: ServiceMediaItem) => {
    if (item.kind === 'video') void Linking.openURL(item.url);
    else setOpen(item);
  };
  if (!items.length) return null;
  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <View key={item.id} style={styles.cell}>
          <TouchableOpacity onPress={() => openItem(item)} activeOpacity={0.85} accessibilityLabel={item.kind === 'video' ? 'Play video' : 'Open photo'}>
            {item.kind === 'video' ? (
              <View style={[styles.thumb, styles.videoThumb]}>
                <Ionicons name="play-circle" size={34} color="#fff" />
                <Text style={styles.videoText}>VIDEO</Text>
              </View>
            ) : (
              <Image source={{ uri: item.url }} style={styles.thumb} />
            )}
            {item.label ? <Text style={[styles.badge, item.label === 'before' && styles.badgeBefore, item.label === 'after' && styles.badgeAfter]}>{MEDIA_LABEL_TEXT[item.label]}</Text> : null}
            {item.hiddenFromCustomer ? <Text style={styles.hiddenBadge}>Hidden</Text> : null}
          </TouchableOpacity>
          {item.caption ? <Text style={[styles.caption, dark && styles.captionDark]} numberOfLines={2}>{item.caption}</Text> : null}
          <Text style={[styles.meta, dark && styles.metaDark]} numberOfLines={1}>{fmtTaken(item.takenAt)}</Text>
          {onToggleHidden || onDelete ? (
            <View style={styles.actions}>
              {onToggleHidden ? (
                <TouchableOpacity onPress={() => onToggleHidden(item)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={styles.action}>{item.hiddenFromCustomer ? 'Show' : 'Hide'}</Text>
                </TouchableOpacity>
              ) : null}
              {onDelete ? (
                <TouchableOpacity onPress={() => onDelete(item)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={[styles.action, { color: colors.danger }]}>Delete</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>
      ))}
      {open ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(null)}>
          <Pressable style={styles.viewer} onPress={() => setOpen(null)}>
            <Image source={{ uri: open.url }} style={styles.full} resizeMode="contain" />
            <View style={styles.viewerBar}>
              <Text style={styles.viewerText}>
                {open.label ? `${MEDIA_LABEL_TEXT[open.label]} · ` : ''}{open.scheduledDate ? fmtDate(open.scheduledDate) : fmtTaken(open.takenAt)}{open.technicianName ? ` · ${open.technicianName}` : ''}
              </Text>
              {open.caption ? <Text style={styles.viewerCaption}>{open.caption}</Text> : null}
              <Text style={styles.viewerHint}>Tap to close</Text>
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

/** Group media by visit for a customer-wide gallery. */
export function groupMediaByVisit(items: ServiceMediaItem[]) {
  const groups = new Map<string, { appointmentId: string | null; scheduledDate: string | null; status: string | null; items: ServiceMediaItem[] }>();
  for (const it of items) {
    const key = it.appointmentId ?? 'none';
    if (!groups.has(key)) groups.set(key, { appointmentId: it.appointmentId, scheduledDate: it.scheduledDate, status: it.appointmentStatus, items: [] });
    groups.get(key)!.items.push(it);
  }
  return Array.from(groups.values());
}

export function MediaScroller({ items, dark }: { items: ServiceMediaItem[]; dark?: boolean }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <ServiceMediaGrid items={items} dark={dark} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  cell: { width: 104 },
  thumb: { width: 104, height: 104, borderRadius: 10, backgroundColor: '#E6ECEB' },
  videoThumb: { backgroundColor: '#1B2B28', alignItems: 'center', justifyContent: 'center' },
  videoText: { color: '#fff', fontSize: 10, fontWeight: '800', marginTop: 2, letterSpacing: 1 },
  badge: { position: 'absolute', left: 6, top: 6, backgroundColor: colors.primary, color: '#0D0D0D', fontSize: 9, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  badgeBefore: { backgroundColor: '#FFD166' },
  badgeAfter: { backgroundColor: '#7BE0C3' },
  hiddenBadge: { position: 'absolute', right: 6, top: 6, backgroundColor: '#B3261E', color: '#fff', fontSize: 9, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  caption: { fontSize: 11, color: colors.text, marginTop: 4, lineHeight: 14 },
  captionDark: { color: '#fff' },
  meta: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  metaDark: { color: '#A8B5B2' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  action: { fontSize: 12, fontWeight: '800', color: colors.primaryDark },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)', justifyContent: 'center' },
  full: { width: '100%', height: '80%' },
  viewerBar: { position: 'absolute', bottom: 30, left: 0, right: 0, alignItems: 'center', paddingHorizontal: 20 },
  viewerText: { color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  viewerCaption: { color: '#D5E2DF', fontSize: 13, marginTop: 4, textAlign: 'center' },
  viewerHint: { color: '#8A9C98', fontSize: 11, marginTop: 8 },
});
