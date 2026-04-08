import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { MainTabParamList } from './types';
import { HomeScreen }      from '../screens/main/HomeScreen';
import { MedicinesScreen } from '../screens/main/MedicinesScreen';
import { InsightsScreen }  from '../screens/main/InsightsScreen';
import { CareScreen }      from '../screens/main/CareScreen';
import { ProfileScreen }   from '../screens/main/ProfileScreen';
import { Colors, FontSize } from '../design/tokens';

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, string> = {
  Home:      '🏠',
  Medicines: '💊',
  Insights:  '📊',
  Care:      '🩺',
  Profile:   '👤',
};

export function MainNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => (
          <Text style={{ fontSize: focused ? 24 : 20, opacity: focused ? 1 : 0.6 }}>
            {TAB_ICONS[route.name]}
          </Text>
        ),
        tabBarActiveTintColor:   Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarLabelStyle: { fontSize: FontSize.xs, marginBottom: 2 },
        tabBarStyle: {
          borderTopColor: Colors.border,
          paddingTop: 4,
          height: 60,
        },
      })}
    >
      <Tab.Screen name="Home"      component={HomeScreen}      options={{ title: 'Home' }} />
      <Tab.Screen name="Medicines" component={MedicinesScreen} options={{ title: 'Medicines' }} />
      <Tab.Screen name="Insights"  component={InsightsScreen}  options={{ title: 'Insights' }} />
      <Tab.Screen name="Care"      component={CareScreen}      options={{ title: 'Care' }} />
      <Tab.Screen name="Profile"   component={ProfileScreen}   options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}
