import React, { useRef, useState } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import ViewShot from 'react-native-view-shot';
import { colors } from '../lib/theme';

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  capture: () => Promise<string>;
}

export const SignaturePad = React.forwardRef<SignaturePadHandle, { height?: number }>(
  ({ height = 260 }, ref) => {
    const [paths, setPaths] = useState<string[]>([]);
    const currentPath = useRef<string>('');
    const [livePath, setLivePath] = useState<string>('');
    const shotRef = useRef<React.ComponentRef<typeof ViewShot> & { capture?: () => Promise<string> }>(null);

    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          currentPath.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          setLivePath(currentPath.current);
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          currentPath.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          setLivePath(currentPath.current);
        },
        onPanResponderRelease: () => {
          if (currentPath.current) {
            setPaths((p) => [...p, currentPath.current]);
            currentPath.current = '';
            setLivePath('');
          }
        },
      }),
    ).current;

    React.useImperativeHandle(ref, () => ({
      clear: () => {
        setPaths([]);
        setLivePath('');
        currentPath.current = '';
      },
      isEmpty: () => paths.length === 0 && !livePath,
      capture: async () => {
        const shot = shotRef.current;
        if (!shot?.capture) throw new Error('Signature capture unavailable');
        return shot.capture();
      },
    }));

    return (
      <ViewShot ref={shotRef} options={{ format: 'png', quality: 1, result: 'tmpfile' }}>
        <View style={[styles.pad, { height }]} {...panResponder.panHandlers}>
          <Svg width="100%" height="100%">
            {paths.map((d, i) => (
              <Path key={i} d={d} stroke={colors.text} strokeWidth={2.5} fill="none" strokeLinecap="round" />
            ))}
            {livePath ? (
              <Path d={livePath} stroke={colors.text} strokeWidth={2.5} fill="none" strokeLinecap="round" />
            ) : null}
          </Svg>
        </View>
      </ViewShot>
    );
  },
);

const styles = StyleSheet.create({
  pad: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
});
