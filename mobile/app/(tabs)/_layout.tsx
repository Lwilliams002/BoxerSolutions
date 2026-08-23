import React from 'react';
import { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/lib/authStore';

type IconName = keyof typeof Ionicons.glyphMap;

function icon(focused: IconName, unfocused: IconName) {
  return ({ color, focused: f, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <Ionicons name={f ? focused : unfocused} size={size} color={color} />
  );
}

export default function TabsLayout() {
  const hasPermission = useAuth((s) => s.hasPermission);

  const canSchedule = hasPermission('appointments:read', 'appointments:write');
  const canCustomers = hasPermission('customers:read', 'customers:read_assigned', 'appointments:read_assigned');
  const canInvoices = hasPermission('invoices:read', 'invoices:read_assigned', 'payments:collect');
  const user = useAuth((s) => s.user);
  const canMap = !!user?.roles?.some((role) => role === 'TECHNICIAN' || role === 'TRUSTED_TECHNICIAN');

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: '#0D0D0D',
          borderTopColor: '#222',
          borderTopWidth: 1,
          paddingTop: 4,
        },
        tabBarActiveTintColor: '#2DC4A2',
        tabBarInactiveTintColor: '#6B7C78',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerStyle: { backgroundColor: '#0D0D0D' },
        headerTintColor: '#2DC4A2',
        headerTitleStyle: { color: '#FFFFFF', fontWeight: '700' },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Dashboard', headerShown: false, tabBarIcon: icon('grid', 'grid-outline') }}
      />
      <Tabs.Screen
        name="routes"
        options={{ title: 'Routes', headerShown: false, tabBarIcon: icon('navigate', 'navigate-outline') }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Schedule',
          headerShown: false,
          href: canSchedule ? undefined : null,
          tabBarIcon: icon('calendar', 'calendar-outline'),
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: 'Customers',
          href: canCustomers ? undefined : null,
          tabBarIcon: icon('people', 'people-outline'),
        }}
      />
      <Tabs.Screen
        name="invoices"
        options={{
          title: 'Invoices',
          href: canInvoices ? undefined : null,
          tabBarIcon: icon('receipt', 'receipt-outline'),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          href: canMap ? undefined : null,
          tabBarIcon: icon('map', 'map-outline'),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: icon('menu', 'menu-outline') }}
      />
    </Tabs>
  );
}
