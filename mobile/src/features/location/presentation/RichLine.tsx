import { Text, type TextStyle } from 'react-native';

import { fontWeight } from '@/core/theme';
import type { RichText } from '../domain/gateCopy';

/** Text with bold fragments (the copy marks them in `gateCopy.ts`). */
export function RichLine({ parts, style }: { parts: RichText; style?: TextStyle | TextStyle[] }) {
  return (
    <Text style={style}>
      {parts.map((part, index) => (
        <Text key={index} style={part.bold ? { fontWeight: fontWeight.bold } : undefined}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}
