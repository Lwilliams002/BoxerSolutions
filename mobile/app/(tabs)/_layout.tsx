import React from 'react';
import { ColorValue, Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useAuth } from '../../src/lib/authStore';
import { colors } from '../../src/lib/theme';

function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const hasPermission = useAuth((s) => s.hasPermission);

  const canSchedule = hasPermission('appointments:read', 'appointments:write');
  const canCustomers = hasPermission('customers:read', 'customers:read_assigned', 'appointments:read_assigned');
  const canInvoices = hasPermission('invoices:read', 'invoices:read_assigned', 'payments:collect');

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: '#0D0D0D', borderTopColor: '#1A1A1A' },
        tabBarActiveTintColor: '#2DC4A2',
        tabBarInactiveTintColor: '#607D78',
        headerStyle: { backgroundColor: '#0D0D0D' },
        headerTintColor: '#2DC4A2',
        headerTitleStyle: { color: '#FFFFFF', fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Dashboard', tabBarIcon: ({ color }) => <TabIcon glyph="◈" color={color} /> }}
      />
      <Tabs.Screen
        name="routes"
        options={{ title: 'Routes', tabBarIcon: ({ color }) => <TabIcon glyph="⚑" color={color} /> }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Schedule',
          href: canSchedule ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon glyph="▦" color={color} />,
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: 'Customers',
          href: canCustomers ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color} />,
        }}
      />
      <Tabs.Screen
        name="invoices"
        options={{
          title: 'Invoices',
          href: canInvoices ? undefined : null,
          tabBarIcon: ({ color }) => <TabIcon glyph="▤" color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: ({ color }) => <TabIcon glyph="≡" color={color} /> }}
      />
    </Tabs>
  );
}
