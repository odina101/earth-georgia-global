/**
 * 3D Globe Component - Stripe-style dotted Earth visualization
 * Uses TopoJSON world-atlas for REAL accurate continent shapes
 *
 * Performance optimizations:
 * - Shared geometries for repeated meshes
 * - Reduced polygon counts
 * - Cached TopoJSON data
 * - Optimized animation loop with delta time
 * - Efficient for loops instead of forEach
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface GlobeConnection {
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  /** Hex color string. Cycles through defaults when omitted. */
  color?: string;
}

export interface GlobeHighlight {
  /** ISO numeric country code, e.g. '268' for Georgia, '840' for the USA. */
  countryISO: string;
  /** Dot color for highlighted country. Default: '#ff4d4d' */
  color?: string;
  /**
   * 3D center point used for the magnification effect.
   * Auto-computed from country polygons when omitted.
   */
  center?: { lat: number; lng: number };
  /**
   * Lat/lng bounding box scanned for country dots.
   * Auto-computed from country polygons when omitted.
   */
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  /** Magnification scale factor. Default: 3.5 */
  scale?: number;
  /** Point size in pixels for highlighted dots. Default: 13 */
  dotSize?: number;
  /** Grid step in degrees for highlighted country dots (smaller = denser). Default: 0.20 */
  dotDensity?: number;
}

export interface GlobeProps {
  /** Color of land dots. Default: '#ffffff' */
  dotColor?: string;
  /** Point size in pixels for land dots. Default: 6 */
  dotSize?: number;
  /** Grid step in degrees for dot density (smaller = more dots). Default: 1.0 */
  dotDensity?: number;
  /** Country to highlight with elevated colored dots. Omit to disable. */
  highlight?: GlobeHighlight;
  /** Arc connections to render. Defaults to 10 routes from Tbilisi to world cities. */
  connections?: GlobeConnection[];
  /** Lat/lng the globe centers on and snaps back to after interaction. Default: Tbilisi */
  focusPoint?: { lat: number; lng: number };
  /** Smoothly return to focusPoint after the user releases the globe. Default: true */
  magnetToFocus?: boolean;
  /** CSS class for the container div */
  className?: string;
  /** Inline styles for the container div */
  style?: React.CSSProperties;
}

// ─── Internals ────────────────────────────────────────────────────────────────

const WORLD_ATLAS_URL = 'https://unpkg.com/world-atlas@2/land-110m.json';
const COUNTRIES_URL   = 'https://unpkg.com/world-atlas@2/countries-110m.json';

let cachedLandTopo: any      = null;
let cachedCountriesTopo: any = null;

async function loadTopoData() {
  if (cachedLandTopo && cachedCountriesTopo) {
    return { landTopo: cachedLandTopo, countriesTopo: cachedCountriesTopo };
  }
  const [landTopo, countriesTopo] = await Promise.all([
    fetch(WORLD_ATLAS_URL).then(r => r.json()),
    fetch(COUNTRIES_URL).then(r => r.json()),
  ]);
  cachedLandTopo      = landTopo;
  cachedCountriesTopo = countriesTopo;
  return { landTopo, countriesTopo };
}

const TBILISI_COORDS = { lat: 41.7151, lng: 44.8271 };

const DEFAULT_ARC_COLORS = [
  '#80E9FF', '#FECA57', '#5FD068', '#FF6B6B', '#FF9F43',
  '#A855F7', '#60A5FA', '#F472B6', '#34D399', '#FBBF24',
];

const DEFAULT_CONNECTIONS: GlobeConnection[] = [
  { start: TBILISI_COORDS, end: { lat: 40.7128,  lng: -74.006  }, color: '#80E9FF' },
  { start: TBILISI_COORDS, end: { lat: 35.6762,  lng: 139.6503 }, color: '#FECA57' },
  { start: TBILISI_COORDS, end: { lat: -33.8688, lng: 151.2093 }, color: '#5FD068' },
  { start: TBILISI_COORDS, end: { lat: 37.7749,  lng: -122.4194}, color: '#FF6B6B' },
  { start: TBILISI_COORDS, end: { lat: 41.0082,  lng: 28.9784  }, color: '#FF9F43' },
  { start: TBILISI_COORDS, end: { lat: 25.2048,  lng: 55.2708  }, color: '#A855F7' },
  { start: TBILISI_COORDS, end: { lat: 55.7558,  lng: 37.6173  }, color: '#60A5FA' },
  { start: TBILISI_COORDS, end: { lat: 51.5074,  lng: -0.1278  }, color: '#F472B6' },
  { start: TBILISI_COORDS, end: { lat: 52.52,    lng: 13.405   }, color: '#34D399' },
  { start: TBILISI_COORDS, end: { lat: 48.8566,  lng: 2.3522   }, color: '#FBBF24' },
];

/** Compute the center lat/lng and bounding box from a set of polygons. */
function computePolygonsMeta(polygons: number[][][]): {
  center: { lat: number; lng: number };
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
} {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  let sumLng = 0, sumLat = 0, count = 0;
  for (const polygon of polygons) {
    for (const pt of polygon) {
      const lng = pt[0], lat = pt[1];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      sumLng += lng; sumLat += lat; count++;
    }
  }
  return {
    center: { lat: sumLat / count, lng: sumLng / count },
    bounds: { minLat, maxLat, minLng, maxLng },
  };
}

// ─── Shaders ──────────────────────────────────────────────────────────────────

const dotVertexShader = `
  uniform float u_time;
  uniform float u_drag_time;
  uniform float u_is_dragging;
  uniform float u_point_size;
  attribute float rndId;
  attribute vec3 color;
  varying float vRndId;
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vRndId = rndId;
    vColor = color;

    vec3 worldNormal = normalize(normalMatrix * normalize(position));
    vec3 viewDir     = normalize(-vec3(modelViewMatrix * vec4(position, 1.0)));
    vDepth = dot(worldNormal, viewDir);

    float breatheFactor = 1.0;
    if (u_is_dragging > 0.5) {
      float dragIntensity = min(1.0, u_drag_time / 1200.0);
      breatheFactor = 1.0 + ((sin(u_time * 0.003 + rndId * 10.0) + 1.0) * 0.015) * dragIntensity;
    }

    vec3 newPosition = position * breatheFactor;
    vec4 modelViewPosition = modelViewMatrix * vec4(newPosition, 1.0);
    gl_Position = projectionMatrix * modelViewPosition;
    gl_PointSize = u_point_size;
  }
`;

const dotFragmentShader = `
  uniform float u_time;
  uniform float u_drag_time;
  uniform float u_is_dragging;
  varying float vRndId;
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist   = length(center);

    float radius = 0.4;
    float circle = 1.0 - smoothstep(radius - 0.15, radius, dist);
    if (circle < 0.05) discard;

    float depthFactor = smoothstep(-0.3, 0.5, vDepth);
    float baseAlpha   = mix(0.1, 0.8, depthFactor);

    float shimmer = sin(u_time * 0.002 + vRndId * 6.28) * 0.05 + 0.95;
    float alpha   = baseAlpha * shimmer * circle;

    vec3 finalColor = vColor;
    if (u_is_dragging > 0.5) {
      float dragIntensity = min(1.0, u_drag_time / 1200.0);
      float rShift = sin(u_drag_time * 0.002 + 1.0) * 0.08 * dragIntensity;
      float gShift = sin(u_drag_time * 0.0015 - 1.0) * 0.08 * dragIntensity;
      float bShift = sin(u_drag_time * 0.001)         * 0.08 * dragIntensity;
      finalColor   = vColor + vec3(rShift, gShift, bShift);
      alpha        = min(1.0, alpha + 0.15 * dragIntensity);
    }

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

const highlightVertexShader = `
  uniform float u_time;
  uniform float u_point_size;
  attribute float rndId;
  attribute vec3 color;
  varying float vRndId;
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vRndId = rndId;
    vColor = color;

    vec3 worldNormal = normalize(normalMatrix * normalize(position));
    vec3 viewDir     = normalize(-vec3(modelViewMatrix * vec4(position, 1.0)));
    vDepth = dot(worldNormal, viewDir);

    vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position  = projectionMatrix * modelViewPosition;
    gl_PointSize = u_point_size;
  }
`;

const highlightFragmentShader = `
  uniform float u_time;
  varying float vRndId;
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist   = length(center);

    float radius = 0.4;
    float circle = 1.0 - smoothstep(radius - 0.15, radius, dist);
    if (circle < 0.05) discard;

    float depthFactor = smoothstep(-0.5, 0.3, vDepth);
    float baseAlpha   = mix(0.4, 1.0, depthFactor);

    float pulse = sin(u_time * 0.002 + vRndId * 3.14) * 0.08 + 0.92;
    float alpha = baseAlpha * pulse * circle;

    gl_FragColor = vec4(vColor, alpha);
  }
`;

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function latLngTo3D(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
     radius * Math.cos(phi),
     radius * Math.sin(phi) * Math.sin(theta),
  );
}

const polygonBoundsCache = new WeakMap<number[][], { minX: number; maxX: number; minY: number; maxY: number }>();

function getPolygonBounds(polygon: number[][]): { minX: number; maxX: number; minY: number; maxY: number } {
  let cached = polygonBoundsCache.get(polygon);
  if (cached) return cached;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const x = polygon[i][0], y = polygon[i][1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  cached = { minX, maxX, minY, maxY };
  polygonBoundsCache.set(polygon, cached);
  return cached;
}

function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
  const x = point[0], y = point[1];
  const bounds = getPolygonBounds(polygon);
  if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInMultiPolygon(point: [number, number], polygons: number[][][]): boolean {
  for (let i = 0; i < polygons.length; i++) {
    if (pointInPolygon(point, polygons[i])) return true;
  }
  return false;
}

function arcToCoords(topology: any, arcIndexes: number[]): number[][] {
  const coords: number[][] = [];
  const transform = topology.transform;
  for (const arcIndex of arcIndexes) {
    const arc     = topology.arcs[arcIndex < 0 ? ~arcIndex : arcIndex];
    const reverse = arcIndex < 0;
    let x = 0, y = 0;
    const arcCoords: number[][] = [];
    for (const point of arc) {
      x += point[0]; y += point[1];
      let lng = x, lat = y;
      if (transform) {
        lng = x * transform.scale[0] + transform.translate[0];
        lat = y * transform.scale[1] + transform.translate[1];
      }
      arcCoords.push([lng, lat]);
    }
    if (reverse) arcCoords.reverse();
    coords.push(...arcCoords.slice(coords.length > 0 ? 1 : 0));
  }
  return coords;
}

function topoJsonToPolygons(topology: any, objectName: string): number[][][] {
  const polygons: number[][][] = [];
  const obj = topology.objects[objectName];
  if (!obj) return polygons;
  const geometries = obj.type === 'GeometryCollection' ? obj.geometries : [obj];
  for (const geom of geometries) {
    if (geom.type === 'Polygon') {
      for (const ring of geom.arcs) {
        const coords = arcToCoords(topology, ring);
        if (coords.length > 2) polygons.push(coords);
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const polygon of geom.arcs) {
        for (const ring of polygon) {
          const coords = arcToCoords(topology, ring);
          if (coords.length > 2) polygons.push(coords);
        }
      }
    }
  }
  return polygons;
}

function getCountryPolygons(topology: any, countryId: string): number[][][] {
  const polygons: number[][][] = [];
  const countries = topology.objects.countries;
  if (!countries || countries.type !== 'GeometryCollection') return polygons;
  for (const geom of countries.geometries) {
    if (geom.id === countryId || String(geom.id) === countryId) {
      if (geom.type === 'Polygon') {
        for (const ring of geom.arcs) {
          const coords = arcToCoords(topology, ring);
          if (coords.length > 2) polygons.push(coords);
        }
      } else if (geom.type === 'MultiPolygon') {
        for (const polygon of geom.arcs) {
          for (const ring of polygon) {
            const coords = arcToCoords(topology, ring);
            if (coords.length > 2) polygons.push(coords);
          }
        }
      }
    }
  }
  return polygons;
}

// ─── Dot generation ───────────────────────────────────────────────────────────

function generateWorldDots(
  landPolygons: number[][][],
  globeRadius: number,
  dotColorHex: string,
  step: number,
): { positions: number[]; colors: number[]; rndIds: number[] } {
  const positions: number[] = [];
  const colors: number[]    = [];
  const rndIds: number[]    = [];
  const dotColor = new THREE.Color(dotColorHex);

  for (let lat = -85; lat <= 85; lat += step) {
    for (let lng = -180; lng < 180; lng += step) {
      if (!pointInMultiPolygon([lng, lat], landPolygons)) continue;
      const pos = latLngTo3D(lat, lng, globeRadius);
      positions.push(pos.x, pos.y, pos.z);
      const v = 0.95 + Math.random() * 0.05;
      colors.push(dotColor.r * v, dotColor.g * v, dotColor.b * v);
      rndIds.push(Math.random());
    }
  }
  return { positions, colors, rndIds };
}

function generateHighlightDots(
  highlightPolygons: number[][][],
  globeRadius: number,
  center: { lat: number; lng: number },
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  colorHex: string,
  density: number,
  scale: number,
): { positions: number[]; colors: number[]; rndIds: number[] } {
  const positions: number[] = [];
  const colors: number[]    = [];
  const rndIds: number[]    = [];
  const hlColor = new THREE.Color(colorHex);
  const center3D = latLngTo3D(center.lat, center.lng, globeRadius);

  for (let lat = bounds.minLat; lat <= bounds.maxLat; lat += density) {
    for (let lng = bounds.minLng; lng <= bounds.maxLng; lng += density) {
      if (!pointInMultiPolygon([lng, lat], highlightPolygons)) continue;

      const realPos = latLngTo3D(lat, lng, globeRadius);
      const ox = realPos.x - center3D.x;
      const oy = realPos.y - center3D.y;
      const oz = realPos.z - center3D.z;
      const sx = center3D.x + ox * scale;
      const sy = center3D.y + oy * scale;
      const sz = center3D.z + oz * scale;
      const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
      const r   = globeRadius * 1.08;

      positions.push((sx / len) * r, (sy / len) * r, (sz / len) * r);
      const v = 0.9 + Math.random() * 0.1;
      colors.push(hlColor.r * v, hlColor.g * v, hlColor.b * v);
      rndIds.push(Math.random());
    }
  }
  return { positions, colors, rndIds };
}

// ─── Arc / pulse helpers ──────────────────────────────────────────────────────

function createArc(
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: string,
  globeRadius: number,
): { line: THREE.Line; material: THREE.LineBasicMaterial; points: THREE.Vector3[] } {
  const segments  = 50;
  const points: THREE.Vector3[] = new Array(segments + 1);
  const distance  = start.distanceTo(end);
  const arcHeight = Math.min(globeRadius * 0.4, distance * 0.3);

  for (let i = 0; i <= segments; i++) {
    const t     = i / segments;
    const point = new THREE.Vector3().lerpVectors(start, end, t);
    point.normalize().multiplyScalar(globeRadius + arcHeight * Math.sin(t * Math.PI));
    points[i] = point;
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.9,
  });

  return { line: new THREE.Line(geometry, material), material, points };
}

const sharedCoreGeometry     = new THREE.SphereGeometry(0.006, 8, 8);
const sharedGlowGeometry     = new THREE.SphereGeometry(0.012, 8, 8);
const sharedEndpointGeometry = new THREE.CircleGeometry(0.018, 16);
const originVector           = new THREE.Vector3(0, 0, 0);

function createTravelingPulse(color: string): THREE.Group {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(sharedCoreGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })));
  group.add(new THREE.Mesh(sharedGlowGeometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.6 })));
  return group;
}

function createEndpoint(position: THREE.Vector3, color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    sharedEndpointGeometry,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 1, side: THREE.DoubleSide }),
  );
  mesh.position.copy(position);
  mesh.lookAt(originVector);
  return mesh;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** Compute the globe rotation that centers on a given lat/lng. */
function focusRotation(lat: number, lng: number): { x: number; y: number } {
  return {
    x: lat * (Math.PI / 180) * 0.69,
    y: -(lng + 90) * (Math.PI / 180),
  };
}

function normalizeAngle(angle: number): number {
  while (angle >  Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

export default function Globe({
  dotColor      = '#ffffff',
  dotSize       = 6,
  dotDensity    = 1.0,
  highlight     = { countryISO: '268' },
  connections   = DEFAULT_CONNECTIONS,
  focusPoint    = TBILISI_COORDS,
  magnetToFocus = true,
  className,
  style,
}: GlobeProps) {
  const containerRef      = useRef<HTMLDivElement>(null);
  const rendererRef       = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef          = useRef<THREE.Scene | null>(null);
  const cameraRef         = useRef<THREE.PerspectiveCamera | null>(null);
  const globeGroupRef     = useRef<THREE.Group | null>(null);
  const frameIdRef        = useRef<number>(0);
  const dotMaterialRef    = useRef<THREE.ShaderMaterial | null>(null);
  const hlMaterialRef     = useRef<THREE.ShaderMaterial | null>(null);
  const arcsRef           = useRef<{
    line: THREE.Line;
    material: THREE.LineBasicMaterial;
    points: THREE.Vector3[];
    pulse: THREE.Group;
    pulseProgress: number;
    delay: number;
  }[]>([]);
  const endpointsRef      = useRef<{ mesh: THREE.Mesh; phase: number }[]>([]);

  const isDraggingRef        = useRef(false);
  const previousMouseRef     = useRef({ x: 0, y: 0 });
  const targetRotationRef    = useRef(focusRotation(focusPoint.lat, focusPoint.lng));
  const magnetToFocusRef     = useRef(magnetToFocus);
  const dragTimeoutRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartTimeRef     = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width     = container.clientWidth;
    const height    = container.clientHeight;

    // Capture prop values at mount time (Three.js setup runs once)
    const cfg = {
      dotColor,
      dotSize,
      dotDensity,
      highlight,
      connections,
      focusPoint,
      magnetToFocus,
    };

    const focusRot = focusRotation(cfg.focusPoint.lat, cfg.focusPoint.lng);
    targetRotationRef.current = { ...focusRot };
    magnetToFocusRef.current  = cfg.magnetToFocus;

    const scene = new THREE.Scene();
    scene.background = null;
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = width < height ? 4.0 : 2.6;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio < 2,
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.sortObjects = false;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);
    globeGroupRef.current = globeGroup;

    const globeRadius = 1;

    globeGroup.rotation.x = focusRot.x;
    globeGroup.rotation.y = focusRot.y;

    // Build geometry from TopoJSON (async, uses cached data after first load)
    loadTopoData().then(({ landTopo, countriesTopo }) => {
      const landPolygons = topoJsonToPolygons(landTopo, 'land');

      // World dots
      const { positions: wPos, colors: wCol, rndIds: wIds } =
        generateWorldDots(landPolygons, globeRadius, cfg.dotColor, cfg.dotDensity);

      const worldGeo = new THREE.BufferGeometry();
      worldGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
      worldGeo.setAttribute('color',    new THREE.Float32BufferAttribute(wCol, 3));
      worldGeo.setAttribute('rndId',    new THREE.Float32BufferAttribute(wIds, 1));

      const worldMat = new THREE.ShaderMaterial({
        uniforms: {
          u_time:        { value: 0 },
          u_drag_time:   { value: 0 },
          u_is_dragging: { value: 0 },
          u_point_size:  { value: cfg.dotSize },
        },
        vertexShader:   dotVertexShader,
        fragmentShader: dotFragmentShader,
        transparent: true,
      });

      globeGroup.add(new THREE.Points(worldGeo, worldMat));
      dotMaterialRef.current = worldMat;

      // Highlight country dots
      if (cfg.highlight) {
        const hl               = cfg.highlight;
        const hlISO            = hl.countryISO;
        const hlColorHex       = hl.color    ?? '#ff4d4d';
        const hlScale          = hl.scale    ?? 3.5;
        const hlDotSize        = hl.dotSize  ?? 13;
        const hlDotDensity     = hl.dotDensity ?? 0.20;

        const hlPolygons = getCountryPolygons(countriesTopo, hlISO);

        if (hlPolygons.length > 0) {
          const auto          = computePolygonsMeta(hlPolygons);
          const hlCenter      = hl.center ?? auto.center;
          const hlBounds      = hl.bounds ?? auto.bounds;

          const { positions: hPos, colors: hCol, rndIds: hIds } =
            generateHighlightDots(hlPolygons, globeRadius, hlCenter, hlBounds, hlColorHex, hlDotDensity, hlScale);

          if (hPos.length > 0) {
            const hlGeo = new THREE.BufferGeometry();
            hlGeo.setAttribute('position', new THREE.Float32BufferAttribute(hPos, 3));
            hlGeo.setAttribute('color',    new THREE.Float32BufferAttribute(hCol, 3));
            hlGeo.setAttribute('rndId',    new THREE.Float32BufferAttribute(hIds, 1));

            const hlMat = new THREE.ShaderMaterial({
              uniforms: {
                u_time:       { value: 0 },
                u_point_size: { value: hlDotSize },
              },
              vertexShader:   highlightVertexShader,
              fragmentShader: highlightFragmentShader,
              transparent: true,
            });

            globeGroup.add(new THREE.Points(hlGeo, hlMat));
            hlMaterialRef.current = hlMat;
          }
        }
      }

      // Arcs, pulses, endpoints
      cfg.connections.forEach((conn, index) => {
        const color    = conn.color ?? DEFAULT_ARC_COLORS[index % DEFAULT_ARC_COLORS.length];
        const startPos = latLngTo3D(conn.start.lat, conn.start.lng, globeRadius);
        const endPos   = latLngTo3D(conn.end.lat,   conn.end.lng,   globeRadius);

        const { line, material, points } = createArc(startPos, endPos, color, globeRadius);
        globeGroup.add(line);

        const pulse = createTravelingPulse(color);
        globeGroup.add(pulse);

        arcsRef.current.push({ line, material, points, pulse, pulseProgress: Math.random(), delay: index * 0.15 });

        const endEndpoint = createEndpoint(endPos, color);
        globeGroup.add(endEndpoint);
        endpointsRef.current.push({ mesh: endEndpoint, phase: Math.random() * Math.PI * 2 });
      });
    }).catch(err => console.error('Failed to load TopoJSON:', err));

    // ── Interaction handlers ──────────────────────────────────────────────────

    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current    = true;
      previousMouseRef.current = { x: e.clientX, y: e.clientY };
      magnetToFocusRef.current = false;
      dragStartTimeRef.current = performance.now();
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !globeGroupRef.current) return;
      targetRotationRef.current.y += (e.clientX - previousMouseRef.current.x) * 0.005;
      targetRotationRef.current.x += (e.clientY - previousMouseRef.current.y) * 0.005;
      previousMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      if (cfg.magnetToFocus) {
        dragTimeoutRef.current = setTimeout(() => { magnetToFocusRef.current = true; }, 1500);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        isDraggingRef.current    = true;
        previousMouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        magnetToFocusRef.current = false;
        dragStartTimeRef.current = performance.now();
        if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && isDraggingRef.current && globeGroupRef.current) {
        targetRotationRef.current.y += (e.touches[0].clientX - previousMouseRef.current.x) * 0.005;
        targetRotationRef.current.x += (e.touches[0].clientY - previousMouseRef.current.y) * 0.005;
        previousMouseRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchEnd = () => {
      isDraggingRef.current = false;
      if (cfg.magnetToFocus) {
        dragTimeoutRef.current = setTimeout(() => { magnetToFocusRef.current = true; }, 1500);
      }
    };

    container.addEventListener('mousedown',  handleMouseDown);
    container.addEventListener('mousemove',  handleMouseMove);
    container.addEventListener('mouseup',    handleMouseUp);
    container.addEventListener('mouseleave', handleMouseUp);
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove',  handleTouchMove,  { passive: false });
    container.addEventListener('touchend',   handleTouchEnd);

    // ── Animation loop ────────────────────────────────────────────────────────

    let time     = 0;
    let lastTime = performance.now();

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      const now   = performance.now();
      const delta = now - lastTime;
      lastTime    = now;
      time       += delta;

      if (globeGroupRef.current) {
        if (magnetToFocusRef.current && !isDraggingRef.current) {
          const currentY = normalizeAngle(targetRotationRef.current.y);
          const targetY  = focusRot.y;
          let diffY      = targetY - currentY;
          if (diffY >  Math.PI) diffY -= 2 * Math.PI;
          if (diffY < -Math.PI) diffY += 2 * Math.PI;

          targetRotationRef.current.x += (focusRot.x - targetRotationRef.current.x) * 0.09;
          targetRotationRef.current.y += diffY * 0.09;

          if (Math.abs(targetRotationRef.current.x - focusRot.x) < 0.01 && Math.abs(diffY) < 0.01) {
            targetRotationRef.current.x = focusRot.x;
            targetRotationRef.current.y = focusRot.y;
          }
        }

        globeGroupRef.current.rotation.x += (targetRotationRef.current.x - globeGroupRef.current.rotation.x) * 0.08;
        globeGroupRef.current.rotation.y += (targetRotationRef.current.y - globeGroupRef.current.rotation.y) * 0.08;
      }

      if (dotMaterialRef.current) {
        dotMaterialRef.current.uniforms.u_time.value = time;
        if (isDraggingRef.current) {
          dotMaterialRef.current.uniforms.u_drag_time.value   = performance.now() - dragStartTimeRef.current;
          dotMaterialRef.current.uniforms.u_is_dragging.value = 1.0;
        } else {
          const cur = dotMaterialRef.current.uniforms.u_drag_time.value;
          dotMaterialRef.current.uniforms.u_drag_time.value = Math.max(0, cur - 30);
          if (cur <= 0) dotMaterialRef.current.uniforms.u_is_dragging.value = 0.0;
        }
      }

      if (hlMaterialRef.current) {
        hlMaterialRef.current.uniforms.u_time.value = time;
      }

      const arcs       = arcsRef.current;
      const scalePulse = 0.8 + Math.sin(time * 0.01) * 0.2;

      for (let i = 0; i < arcs.length; i++) {
        const arc = arcs[i];
        arc.pulseProgress += 0.006;
        if (arc.pulseProgress > 1.2) arc.pulseProgress = -arc.delay * 0.5;
        const p = arc.pulseProgress;
        if (p > 0 && p < 1) {
          arc.pulse.position.copy(arc.points[(p * (arc.points.length - 1)) | 0]);
          arc.pulse.visible = true;
          arc.pulse.scale.setScalar(scalePulse);
        } else {
          arc.pulse.visible = false;
        }
      }

      const timeScaled = time * 0.003;
      for (let i = 0; i < endpointsRef.current.length; i++) {
        const ep = endpointsRef.current[i];
        ep.mesh.scale.setScalar(1 + Math.sin(timeScaled + ep.phase) * 0.2);
      }

      renderer.render(scene, camera);
    };

    animate();

    // ── Resize ────────────────────────────────────────────────────────────────

    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.position.z = w < h ? 4.0 : 2.6;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // ── Cleanup ───────────────────────────────────────────────────────────────

    return () => {
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousedown',  handleMouseDown);
      container.removeEventListener('mousemove',  handleMouseMove);
      container.removeEventListener('mouseup',    handleMouseUp);
      container.removeEventListener('mouseleave', handleMouseUp);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove',  handleTouchMove);
      container.removeEventListener('touchend',   handleTouchEnd);
      cancelAnimationFrame(frameIdRef.current);
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
      if (rendererRef.current && container.contains(rendererRef.current.domElement)) {
        container.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current?.dispose();
      arcsRef.current      = [];
      endpointsRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className={className ?? 'w-full h-full cursor-grab active:cursor-grabbing'}
      style={{ minHeight: '500px', ...style }}
    />
  );
}
