import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseISO(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function startOfWeek(iso: string): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfMonth(iso: string): string {
  const d = parseISO(iso);
  d.setDate(1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function endOfMonth(iso: string): string {
  const d = parseISO(iso);
  d.setMonth(d.getMonth() + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftMonth(iso: string, delta: number): string {
  const d = parseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, maxDay));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthLabel(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function MonthWeekPicker({
  value,
  onChange,
  compact = false,
}: {
value: string;
onChange: (iso: string) => void;
compact?: boolean;
}) {
const railRef = useRef<ScrollView>(null);
const days = useMemo(() => {
   const start = startOfMonth(value);
   const end = endOfMonth(value);
   const items: string[] = [];
   let cursor = start;
   while (cursor <= end) {
     items.push(cursor);
     cursor = addDays(cursor, 1);
   }
   return items;
}, [value]);
const activeIndex = days.findIndex((day) => day === value);

useEffect(() => {
   if (activeIndex >= 0) {
     requestAnimationFrame(() => {
       railRef.current?.scrollTo({
         x: Math.max(0, activeIndex * 64 - 96),
         animated: true,
       });
     });
   }
}, [activeIndex, days]);

return (
   <View style={[styles.wrap, compact && styles.wrapCompact]}>
     <View style={styles.headerRow}>
       <TouchableOpacity style={styles.monthBtn} onPress={() => onChange(shiftMonth(value, -1))}>
         <Ionicons name="chevron-back" size={18} color={colors.text} />
       </TouchableOpacity>
        <Text style={styles.monthTitle}>{monthLabel(value)}</Text>
        <TouchableOpacity style={styles.monthBtn} onPress={() => onChange(shiftMonth(value, 1))}>
         <Ionicons name="chevron-forward" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView ref={railRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRail}>
        {days.map((day) => {
          const dt = parseISO(day);
          const active = day === value;
          return (
            <TouchableOpacity key={day} style={[styles.dayCell, active && styles.dayCellActive]} onPress={() => onChange(day)}>
              <Text style={[styles.dayDow, active && styles.dayTextActive]}>
                {dt.toLocaleDateString(undefined, { weekday: 'short' })}
              </Text>
              <Text style={[styles.dayNum, active && styles.dayTextActive]}>
                {dt.getDate()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#111',
    paddingTop: 12,
    paddingBottom: 10,
  },
  wrapCompact: {
    paddingTop: 8,
    paddingBottom: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  monthBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1D1D1D',
  },
  monthTitle: {
    color: '#fff',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  dayRail: {
    paddingHorizontal: 14,
    paddingBottom: 2,
  },
  dayCell: {
    width: 56,
    minHeight: 62,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: '#1D1D1D',
  },
  dayCellActive: {
    backgroundColor: colors.primary,
  },
  dayDow: {
    color: '#6B7C78',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  dayNum: {
    color: '#fff',
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '900',
    marginTop: 1,
  },
  dayTextActive: {
    color: colors.text,
  },
});
