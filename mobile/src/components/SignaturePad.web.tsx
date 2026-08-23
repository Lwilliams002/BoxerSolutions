import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { colors } from '../lib/theme';

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  capture: () => Promise<string>;
}

type Point = { x: number; y: number };

export const SignaturePad = React.forwardRef<
  SignaturePadHandle,
  { height?: number; onStrokeStart?: () => void; onStrokeEnd?: () => void }
>(({ height = 260, onStrokeStart, onStrokeEnd }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const lastPoint = useRef<Point | null>(null);

  const drawLine = (from: Point, to: Point) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const getPoint = (event: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in event) {
      const touch = event.touches[0] ?? event.changedTouches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const startDrawing = (event: React.MouseEvent | React.TouchEvent) => {
    event.preventDefault();
    const point = getPoint(event);
    onStrokeStart?.();
    setIsDrawing(true);
    lastPoint.current = point;
    setHasInk(true);
  };

  const draw = (event: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !lastPoint.current) return;
    event.preventDefault();
    const point = getPoint(event);
    drawLine(lastPoint.current, point);
    lastPoint.current = point;
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPoint.current = null;
    onStrokeEnd?.();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    setHasInk(false);
    setIsDrawing(false);
    lastPoint.current = null;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
    }
  }, [width, height]);

  useImperativeHandle(ref, () => ({
    clear,
    isEmpty: () => !hasInk,
    capture: async () => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Signature capture unavailable');
      return canvas.toDataURL('image/png');
    },
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    if (event.nativeEvent.layout.width > 0) {
      setWidth(Math.round(event.nativeEvent.layout.width));
    }
  };

  return (
    <View style={[styles.pad, { height }]} onLayout={onLayout}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
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
