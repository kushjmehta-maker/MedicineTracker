import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MainTabParamList } from './types';
import { HomeScreen }      from '../screens/main/HomeScreen';
import { MedicinesScreen } from '../screens/main/MedicinesScreen';
import { InsightsScreen }  from '../screens/main/InsightsScreen';
import { CareScreen }      from '../screens/main/CareScreen';
import { ProfileScreen }   from '../screens/main/ProfileScreen';
import { Colors, FontSize } from '../design/tokens';
import { Icon, IconName } from '../design/icons';

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, IconName> = {
  Home:      'home',
  Medicines: 'pill',
  Insights:  'chart',
  Care:      'stethoscope',
  Profile:   'account',
};

export function MainNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color }) => (
          <Icon
            name={TAB_ICONS[route.name]}
            size={24}
            color={color}
          />
        ),
        tabBarActiveTintColor:   Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarLabelStyle: { fontSize: 10 },
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
