import React from 'react';
import { Composition, staticFile } from 'remotion';
import { Motion, TL } from './Motion';
// timeline.json (public/) is written by compose-area.sh; duration and fps come from it
export const Root: React.FC = () => <Composition id="Motion" component={Motion as any} width={1080} height={1920} fps={24} durationInFrames={24}
  defaultProps={{ tl: null as unknown as TL }}
  calculateMetadata={async () => { const tl: TL = await (await fetch(staticFile('timeline.json'))).json(); return { durationInFrames: tl.total, fps: tl.fps, props: { tl } }; }} />;
