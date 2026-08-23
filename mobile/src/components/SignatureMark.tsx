import React from 'react';
import { Image, StyleProp, View, type ImageStyle, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

export function SignatureMark({ dataUrl, style }: { dataUrl: string | null; style?: StyleProp<ViewStyle> }) {
  if (!dataUrl) return null;

  if (dataUrl.startsWith('data:image/svg+xml')) {
    const xml = decodeURIComponent(dataUrl.split(',')[1] ?? '');
    return (
      <View style={style}>
        <SvgXml xml={xml} width="100%" height="100%" />
      </View>
    );
  }

  return <Image source={{ uri: dataUrl }} style={style as StyleProp<ImageStyle>} resizeMode="contain" />;
}
