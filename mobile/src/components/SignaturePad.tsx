import React, { useImperativeHandle, useRef, useState } from 'react';
import { View, StyleSheet, PanResponder, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors } from '../lib/theme';

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  capture: () => Promise<string>;
}

type Point = { x: number; y: number };

const STROKE_COLOR = colors.text;
const STROKE_WIDTH = 2.5;

export const SignaturePad = React.forwardRef<
  SignaturePadHandle,
  { height?: number; onStrokeStart?: () => void; onStrokeEnd?: () => void }
>(({ height = 260, onStrokeStart, onStrokeEnd }, ref) => {
  const [paths, setPaths] = useState<string[]>([]);
  const [livePath, setLivePath] = useState('');
  const currentPath = useRef('');
  const pathsRef = useRef<string[]>([]);
  const [size, setSize] = useState({ width: 720, height });

  const getPoint = (event: any): Point => {
    const { locationX, locationY } = event.nativeEvent;
    return { x: locationX, y: locationY };
  };

  const commitStroke = () => {
    const finished = currentPath.current;
    currentPath.current = '';
    if (finished) {
      pathsRef.current = [...pathsRef.current, finished];
      setPaths(pathsRef.current);
    }
    setLivePath('');
    onStrokeEnd?.();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt) => {
        onStrokeStart?.();
        const { x, y } = getPoint(evt);
        currentPath.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
        setLivePath(currentPath.current);
      },
      onPanResponderMove: (evt) => {
        const { x, y } = getPoint(evt);
        currentPath.current += ` L${x.toFixed(1)},${y.toFixed(1)}`;
        setLivePath(currentPath.current);
      },
      onPanResponderRelease: commitStroke,
      onPanResponderTerminate: commitStroke,
    }),
  ).current;

  const clear = () => {
    pathsRef.current = [];
    currentPath.current = '';
    setPaths([]);
    setLivePath('');
  };

  const buildSvg = () => {
    const { width, height: h } = size;
    const strokes = pathsRef.current
      .map(
        (d) =>
          `<path d="${d}" stroke="${STROKE_COLOR}" stroke-width="${STROKE_WIDTH}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}"><rect width="${width}" height="${h}" fill="#ffffff"/>${strokes}</svg>`;
  };

  useImperativeHandle(ref, () => ({
    clear,
    isEmpty: () => pathsRef.current.length === 0 && !currentPath.current,
    capture: async () => {
      const svg = buildSvg();
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    },
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height: h } = event.nativeEvent.layout;
    if (width > 0 && h > 0) {
      setSize({ width: Math.round(width), height: Math.round(h) });
    }
  };

  return (
    <View style={[styles.pad, { height }]} onLayout={onLayout} {...panResponder.panHandlers}>
      <Svg width="100%" height="100%">
        <Rect x={0} y={0} width="100%" height="100%" fill="#fff" />
        {paths.map((d, i) => (
          <Path
            key={i}
            d={d}
            stroke={STROKE_COLOR}
            strokeWidth={STROKE_WIDTH}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {livePath ? (
          <Path
            d={livePath}
            stroke={STROKE_COLOR}
            strokeWidth={STROKE_WIDTH}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  pad: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
});
