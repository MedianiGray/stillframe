export type ToolMode = 'snap' | 'scroll' | 'record' | 'ocr' | 'translate';

export type ViewId = 'capture' | 'library' | 'settings';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Annotation =
  | { id: string; kind: 'rect'; color: string; weight: number; rect: Rect }
  | { id: string; kind: 'ellipse'; color: string; weight: number; rect: Rect }
  | { id: string; kind: 'arrow'; color: string; weight: number; from: Point; to: Point }
  | { id: string; kind: 'pen'; color: string; weight: number; points: Point[] }
  | { id: string; kind: 'highlight'; color: string; rect: Rect }
  | { id: string; kind: 'mosaic'; rect: Rect; block: number }
  | { id: string; kind: 'text'; color: string; size: number; pos: Point; text: string; lineHeight?: number }
  | { id: string; kind: 'step'; color: string; pos: Point; index: number };

export type AnnotationKind = Annotation['kind'];

export interface ShotMeta {
  id: string;
  kind: 'image' | 'video';
  createdAt: number;
  width: number;
  height: number;
  bytes: number;
  text?: string;
  thumb?: string;
}

export interface ShotRecord extends ShotMeta {
  blob: Blob;
}

export interface CaptureResult {
  canvas: HTMLCanvasElement;
  stream: MediaStream;
  /** device pixel ratio between captured pixels and CSS pixels */
  scale: number;
}
