import { Link } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.brand}>Alt Art Tracker</Text>
        <Text style={styles.tagline}>Card alerts that actually move</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            style={styles.input}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#999"
            secureTextEntry
            autoComplete="current-password"
            style={styles.input}
          />

          <Pressable style={styles.primaryButton} disabled>
            <Text style={styles.primaryButtonText}>Sign in</Text>
          </Pressable>

          <Text style={styles.note}>Auth wires up Day 4. This is a wireframe.</Text>
        </View>

        <Link href="/(tabs)" style={styles.link}>
          Skip to app (dev only)
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  inner: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  brand: {
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 4,
  },
  tagline: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
  },
  form: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  primaryButton: {
    marginTop: 20,
    backgroundColor: '#111',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  note: {
    fontSize: 12,
    color: '#999',
    marginTop: 12,
    textAlign: 'center',
  },
  link: {
    marginTop: 24,
    color: '#0066cc',
    textAlign: 'center',
    fontSize: 14,
  },
});
