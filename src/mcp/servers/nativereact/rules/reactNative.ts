import type { Rule } from '../types.js';
import { scanLines, scanContent } from './utils.js';

const DEPRECATED_RN_MODULES = [
  'AsyncStorage', 'NetInfo', 'CameraRoll', 'Clipboard', 'Geolocation',
  'ImagePickerIOS', 'StatusBarIOS', 'PushNotificationIOS',
];

const DEPRECATED_EXPO_PACKAGES = [
  'expo-permissions', 'expo-face-detector', 'expo-analytics-amplitude',
  'expo-analytics-segment', 'expo-firebase-analytics', 'expo-firebase-recaptcha',
  '@unimodules/core', '@unimodules/react-native-adapter',
];

export const reactNativeRules: Rule[] = [
  {
    id: 'rnNoRawText',
    category: 'react-native',
    severity: 'error',
    check(file, projectInfo) {
      if (!projectInfo.isReactNative || !file.isJsx) return [];
      return scanContent(
        file.content,
        />\s*[A-Za-z][^<{]{3,}\s*</,
        m => {
          const text = m[0].trim();
          if (/^\s*</.test(text) || text.length < 4) return '';
          return `Raw text "${text.slice(0, 40)}" outside <Text> component`;
        },
        'In React Native, all text must be wrapped in a <Text> component or it will crash.',
      ).filter(v => v.message !== '');
    },
  },
  {
    id: 'rnNoDeprecatedModules',
    category: 'react-native',
    severity: 'error',
    check(file, projectInfo) {
      if (!projectInfo.isReactNative) return [];
      const violations = [];
      for (const mod of DEPRECATED_RN_MODULES) {
        const found = scanLines(
          file.lines,
          new RegExp(`\\b${mod}\\b`),
          `Deprecated React Native module "${mod}"`,
          `"${mod}" was removed from react-native core. Install the community package @react-native-community/${mod.toLowerCase()} instead.`,
          line => line.includes('import') || line.includes('require'),
        );
        violations.push(...found);
      }
      return violations;
    },
  },
  {
    id: 'rnNoLegacyExpoPackages',
    category: 'react-native',
    severity: 'warning',
    check(file, projectInfo) {
      if (!projectInfo.isReactNative) return [];
      const violations = [];
      for (const pkg of DEPRECATED_EXPO_PACKAGES) {
        const found = scanLines(
          file.lines,
          new RegExp(`from\\s+['"\`]${pkg.replace(/[-@/]/g, '\\$&')}['"\`]`),
          `Deprecated Expo package "${pkg}"`,
          `"${pkg}" is deprecated. Check the Expo SDK changelog for the current replacement.`,
          line => !line.trimStart().startsWith('//'),
        );
        violations.push(...found);
      }
      return violations;
    },
  },
  {
    id: 'rnNoDimensionsGet',
    category: 'react-native',
    severity: 'warning',
    check(file, projectInfo) {
      if (!projectInfo.isReactNative) return [];
      return scanContent(
        file.content,
        /Dimensions\.get\s*\(\s*['"`](?:window|screen)['"`]\s*\)/,
        'Dimensions.get() does not update on window resize or orientation change',
        'Use the useWindowDimensions() hook instead: it re-renders automatically when dimensions change.',
      );
    },
  },
  {
    id: 'rnNoInlineFlatlistRenderitem',
    category: 'react-native',
    severity: 'warning',
    check(file, projectInfo) {
      if (!projectInfo.isReactNative) return [];
      return scanContent(
        file.content,
        /<FlatList[^>]*renderItem\s*=\s*\{(?:\s*\([^)]*\)\s*=>|\s*function\s*\([^)]*\))/,
        'Inline renderItem on FlatList re-creates the function on every render',
        'Extract renderItem to a component constant defined outside the render function and wrap with useCallback.',
      );
    },
  },
  {
    id: 'rnNoLegacyShadowStyles',
    category: 'react-native',
    severity: 'warning',
    check(file, projectInfo) {
      if (!projectInfo.isReactNative) return [];
      return scanLines(
        file.lines,
        /(?:shadowColor|shadowOffset|shadowOpacity|shadowRadius)\s*:/,
        'Legacy shadow styles are not supported in React Native new architecture',
        'Use boxShadow style property instead: boxShadow: "0 2px 4px rgba(0,0,0,0.2)".',
        line => !line.trimStart().startsWith('//'),
      );
    },
  },
  {
    id: 'rnPreferReanimated',
    category: 'react-native',
    severity: 'warning',
    check(file, projectInfo) {
      if (!projectInfo.isReactNative) return [];
      return scanLines(
        file.lines,
        /from\s+['"]react-native['"][^;]*\bAnimated\b|import\s+\{\s*[^}]*\bAnimated\b[^}]*\}\s+from\s+['"]react-native['"]/,
        'Using the built-in Animated API from react-native',
        'Use react-native-reanimated for smoother animations that run on the UI thread without JS bridge overhead.',
        line => !line.trimStart().startsWith('//'),
      );
    },
  },
  {
    id: 'rnNoSingleElementStyleArray',
    category: 'react-native',
    severity: 'warning',
    check(file, projectInfo) {
      if (!projectInfo.isReactNative) return [];
      return scanContent(
        file.content,
        /style\s*=\s*\{\s*\[\s*[\w.]+\s*\]\s*\}/,
        'Single-element style array has unnecessary overhead',
        'Use the style value directly: style={styles.container} instead of style={[styles.container]}.',
      );
    },
  },
];
