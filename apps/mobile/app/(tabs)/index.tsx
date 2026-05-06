import { StyleSheet, Text, View } from 'react-native';

export default function TrendingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trending Now</Text>
      <Text style={styles.subtitle}>Cards moving today</Text>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Feed coming Week 2</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  placeholderText: {
    color: '#999',
    fontSize: 14,
  },
});
