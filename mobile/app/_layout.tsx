import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../src/lib/authStore';
import { useSync } from '../src/lib/offline';
import { Loading } from '../src/components/ui';
import { colors } from '../src/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, hydrated, hydrate } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    void hydrate();
    useSync.getState().init();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!user && !inAuthGroup) router.replace('/(auth)/login');
    else if (user && inAuthGroup) router.replace('/(tabs)');
  }, [user, hydrated, segments]);

  if (!hydrated) return <Loading />;
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: '#0D0D0D' },
              headerTintColor: '#2DC4A2',
              headerTitleStyle: { color: '#FFFFFF', fontWeight: '700' },
              headerBackButtonDisplayMode: 'minimal',
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)/customer-portal" options={{ title: 'Customer Portal' }} />
            <Stack.Screen name="(auth)/customer-portal-verify" options={{ title: 'Verify Login' }} />
            <Stack.Screen name="(auth)/customer-portal-home" options={{ title: 'Customer Portal' }} />
            <Stack.Screen name="(auth)/customer-portal-appointments" options={{ title: 'Appointments' }} />
            <Stack.Screen name="(auth)/customer-portal-invoices" options={{ title: 'Invoices' }} />
            <Stack.Screen name="(auth)/customer-portal-profile" options={{ title: 'Profile' }} />
            <Stack.Screen name="(auth)/customer-portal-request-service" options={{ title: 'Request Service' }} />
            <Stack.Screen name="(auth)/privacy-policy" options={{ title: 'Privacy Policy' }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="customer/[id]" options={{ title: 'Customer' }} />
            <Stack.Screen name="customer/new" options={{ title: 'New Customer', presentation: 'modal' }} />
            <Stack.Screen name="customer/agreement" options={{ title: 'Service Agreement' }} />
            <Stack.Screen name="appointment/new" options={{ title: 'New Appointment', presentation: 'modal' }} />
            <Stack.Screen name="subscription/new" options={{ title: 'New Recurring Plan', presentation: 'modal' }} />
            <Stack.Screen name="route/[id]" options={{ title: 'Route' }} />
            <Stack.Screen name="route/new" options={{ title: 'New Route', presentation: 'modal' }} />
            <Stack.Screen name="stop/[id]" options={{ title: 'Service Stop' }} />
            <Stack.Screen name="invoice/[id]" options={{ title: 'Invoice' }} />
            <Stack.Screen name="invoice/embedded-checkout" options={{ title: 'Embedded Checkout' }} />
            <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
            <Stack.Screen name="reports" options={{ title: 'Reports' }} />
            <Stack.Screen name="admin/services" options={{ title: 'Service Catalog Admin' }} />
            <Stack.Screen name="admin/employees" options={{ title: 'Employees Admin' }} />
            <Stack.Screen name="admin/settings" options={{ title: 'Company Settings' }} />
            <Stack.Screen name="admin/audit" options={{ title: 'Audit Logs' }} />
            <Stack.Screen name="admin/service-requests" options={{ title: 'Service Requests' }} />
            <Stack.Screen name="signature" options={{ title: 'Customer Signature', presentation: 'modal' }} />
          </Stack>
        </AuthGate>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
