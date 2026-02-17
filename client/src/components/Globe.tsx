/**
 * 3D Globe Component - Stripe-style dotted Earth visualization
 * Uses TopoJSON world-atlas for REAL accurate continent shapes
 * Dark theme with colored arcs and Georgia highlighted in red
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

// World atlas TopoJSON for real continent/country boundaries
const WORLD_ATLAS_URL = 'https://unpkg.com/world-atlas@2/land-110m.json';
const COUNTRIES_URL = 'https://unpkg.com/world-atlas@2/countries-110m.json';

// Cache for TopoJSON data (avoids re-fetching on remount)
let cachedLandTopo: any = null;
let cachedCountriesTopo: any = null;

async function loadTopoData() {
  if (cachedLandTopo && cachedCountriesTopo) {
    return { landTopo: cachedLandTopo, countriesTopo: cachedCountriesTopo };
  }
  
  const [landTopo, countriesTopo] = await Promise.all([
    fetch(WORLD_ATLAS_URL).then(r => r.json()),
    fetch(COUNTRIES_URL).then(r => r.json())
  ]);
  
  cachedLandTopo = landTopo;
  cachedCountriesTopo = countriesTopo;
  
  return { landTopo, countriesTopo };
}

// Georgia ISO code
const GEORGIA_ISO = '268';

// Arc connection data - all routes start from Tbilisi, Georgia
const TBILISI = { lat: 41.7151, lng: 44.8271 }; // Georgia capital

const connections = [
  // Far destinations
  { start: TBILISI, end: { lat: 40.7128, lng: -74.006 }, color: '#80E9FF' },   // Georgia to NYC (cyan)
  { start: TBILISI, end: { lat: 35.6762, lng: 139.6503 }, color: '#FECA57' },  // Georgia to Tokyo (yellow)
  { start: TBILISI, end: { lat: -33.8688, lng: 151.2093 }, color: '#5FD068' }, // Georgia to Sydney (green)
  { start: TBILISI, end: { lat: 37.7749, lng: -122.4194 }, color: '#FF6B6B' }, // Georgia to San Francisco (red)
  // Closer destinations
  { start: TBILISI, end: { lat: 41.0082, lng: 28.9784 }, color: '#FF9F43' },   // Georgia to Istanbul (orange)
  { start: TBILISI, end: { lat: 25.2048, lng: 55.2708 }, color: '#A855F7' },   // Georgia to Dubai (purple)
  { start: TBILISI, end: { lat: 55.7558, lng: 37.6173 }, color: '#60A5FA' },   // Georgia to Moscow (blue)
  { start: TBILISI, end: { lat: 51.5074, lng: -0.1278 }, color: '#F472B6' },   // Georgia to London (pink)
  { start: TBILISI, end: { lat: 52.52, lng: 13.405 }, color: '#34D399' },      // Georgia to Berlin (teal)
  { start: TBILISI, end: { lat: 48.8566, lng: 2.3522 }, color: '#FBBF24' },    // Georgia to Paris (gold)
];

// Vertex shader for dots with breathing effect and depth-based opacity
const dotVertexShader = `
  uniform float u_time;
  uniform float u_drag_time;
  uniform float u_is_dragging;
  attribute float rndId;
  attribute vec3 color;
  varying float vRndId;
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vRndId = rndId;
    vColor = color;
    
    vec3 worldNormal = normalize(normalMatrix * normalize(position));
    vec3 viewDir = normalize(-vec3(modelViewMatrix * vec4(position, 1.0)));
    vDepth = dot(worldNormal, viewDir);
    
    float breatheFactor = 1.0;
    if (u_is_dragging > 0.5) {
      float dragIntensity = min(1.0, u_drag_time / 1200.0);
      breatheFactor = 1.0 + ((sin(u_time * 0.003 + rndId * 10.0) + 1.0) * 0.015) * dragIntensity;
    }
    
    vec3 newPosition = position * breatheFactor;
    vec4 modelViewPosition = modelViewMatrix * vec4(newPosition, 1.0);
    gl_Position = projectionMatrix * modelViewPosition;
    gl_PointSize = 6.0;
  }
`;

// Fragment shader - small solid filled dots (like Stripe)
const dotFragmentShader = `
  uniform float u_time;
  uniform float u_drag_time;
  uniform float u_is_dragging;
  varying float vRndId;
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    // Small solid filled circle with soft edge
    float radius = 0.4;
    float circle = 1.0 - smoothstep(radius - 0.15, radius, dist);
    
    if (circle < 0.05) discard;
    
    float depthFactor = smoothstep(-0.3, 0.5, vDepth);
    float baseAlpha = mix(0.1, 0.8, depthFactor);
    
    float shimmer = sin(u_time * 0.002 + vRndId * 6.28) * 0.05 + 0.95;
    float alpha = baseAlpha * shimmer * circle;
    
    vec3 finalColor = vColor;
    if (u_is_dragging > 0.5) {
      float dragIntensity = min(1.0, u_drag_time / 1200.0);
      float rShift = sin(u_drag_time * 0.002 + 1.0) * 0.08 * dragIntensity;
      float gShift = sin(u_drag_time * 0.0015 - 1.0) * 0.08 * dragIntensity;
      float bShift = sin(u_drag_time * 0.001) * 0.08 * dragIntensity;
      finalColor = vColor + vec3(rShift, gShift, bShift);
      alpha = min(1.0, alpha + 0.15 * dragIntensity);
    }
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// Georgia highlight shader - elevated larger dots (3x zoom)
const georgiaVertexShader = `
  uniform float u_time;
  attribute float rndId;
  attribute vec3 color;
  varying float vRndId;
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vRndId = rndId;
    vColor = color;
    
    vec3 worldNormal = normalize(normalMatrix * normalize(position));
    vec3 viewDir = normalize(-vec3(modelViewMatrix * vec4(position, 1.0)));
    vDepth = dot(worldNormal, viewDir);
    
    vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewPosition;
    gl_PointSize = 13.0; // 1.5x smaller dots for better shape
  }
`;

const georgiaFragmentShader = `
  uniform float u_time;
  varying float vRndId;
  varying vec3 vColor;
  varying float vDepth;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    
    // Solid filled circle for Georgia
    float radius = 0.4;
    float circle = 1.0 - smoothstep(radius - 0.15, radius, dist);
    
    if (circle < 0.05) discard;
    
    float depthFactor = smoothstep(-0.5, 0.3, vDepth);
    float baseAlpha = mix(0.4, 1.0, depthFactor);
    
    // Subtle pulse
    float pulse = sin(u_time * 0.002 + vRndId * 3.14) * 0.08 + 0.92;
    float alpha = baseAlpha * pulse * circle;
    
    gl_FragColor = vec4(vColor, alpha);
  }
`;

// Convert lat/lng to 3D sphere coordinates
function latLngTo3D(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);

  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);

  return new THREE.Vector3(x, y, z);
}

// Cached bounding boxes for polygons
const polygonBoundsCache = new WeakMap<number[][], { minX: number; maxX: number; minY: number; maxY: number }>();

// Get or compute bounding box for a polygon
function getPolygonBounds(polygon: number[][]): { minX: number; maxX: number; minY: number; maxY: number } {
  let cached = polygonBoundsCache.get(polygon);
  if (cached) return cached;
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const x = polygon[i][0], y = polygon[i][1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  cached = { minX, maxX, minY, maxY };
  polygonBoundsCache.set(polygon, cached);
  return cached;
}

// Point-in-polygon test with bounding box pre-filter
function pointInPolygon(point: [number, number], polygon: number[][]): boolean {
  const x = point[0], y = point[1];
  
  // Fast bounding box check first
  const bounds = getPolygonBounds(polygon);
  if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
    return false;
  }
  
  // Ray casting algorithm
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

// Convert TopoJSON arcs to coordinate array
function arcToCoords(topology: any, arcIndexes: number[]): number[][] {
  const coords: number[][] = [];
  const transform = topology.transform;
  
  for (const arcIndex of arcIndexes) {
    const arc = topology.arcs[arcIndex < 0 ? ~arcIndex : arcIndex];
    const reverse = arcIndex < 0;
    
    let x = 0, y = 0;
    const arcCoords: number[][] = [];
    
    for (const point of arc) {
      x += point[0];
      y += point[1];
      
      let lng = x, lat = y;
      if (transform) {
        lng = x * transform.scale[0] + transform.translate[0];
        lat = y * transform.scale[1] + transform.translate[1];
      }
      
      arcCoords.push([lng, lat]);
    }
    
    if (reverse) arcCoords.reverse();
    const startIdx = coords.length > 0 ? 1 : 0;
    coords.push(...arcCoords.slice(startIdx));
  }
  
  return coords;
}

// Convert TopoJSON to polygons
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

// Get country polygons by ID
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

// Generate land dots using UNIFORM GRID pattern (like Stripe)
// Fixed spacing creates perfectly aligned horizontal rows
function generateLandDots(
  landPolygons: number[][][],
  georgiaPolygons: number[][][],
  _targetCount: number,
  globeRadius: number
): { worldPositions: number[]; worldColors: number[]; worldRndIds: number[]; georgiaPositions: number[]; georgiaColors: number[]; georgiaRndIds: number[] } {
  const worldPositions: number[] = [];
  const worldColors: number[] = [];
  const worldRndIds: number[] = [];
  const georgiaPositions: number[] = [];
  const georgiaColors: number[] = [];
  const georgiaRndIds: number[] = [];
  
  const dotColor = new THREE.Color(1.0, 1.0, 1.0); // White dots
  const georgiaColor = new THREE.Color(1.0, 0.3, 0.3); // Red for Georgia overlay
  
  const georgiaBounds = { minLat: 41.0, maxLat: 43.6, minLng: 40.0, maxLng: 46.7 };
  
  // Fixed grid spacing - same for lat and lng creates uniform aligned rows
  const step = 1.0; // 1 degree = ~111km, gives nice density
  
  // Iterate through uniform grid - ALL land including Georgia base layer
  for (let lat = -85; lat <= 85; lat += step) {
    for (let lng = -180; lng < 180; lng += step) {
      // Check if this grid point is on land
      if (!pointInMultiPolygon([lng, lat], landPolygons)) continue;
      
      const pos = latLngTo3D(lat, lng, globeRadius);
      worldPositions.push(pos.x, pos.y, pos.z);
      const variation = 0.95 + Math.random() * 0.05;
      worldColors.push(dotColor.r * variation, dotColor.g * variation, dotColor.b * variation);
      worldRndIds.push(Math.random());
    }
  }
  
  // Georgia OVERLAY dots - MAGNIFIED in 3D space (preserves shape)
  const georgiaStep = 0.20; // More dots for better shape
  const scaleFactor = 3.5; // 3.5x magnification
  
  // Get Georgia's 3D center point
  const georgiaCenter3D = latLngTo3D(42.3, 43.5, globeRadius);
  
  for (let lat = georgiaBounds.minLat; lat <= georgiaBounds.maxLat; lat += georgiaStep) {
    for (let lng = georgiaBounds.minLng; lng <= georgiaBounds.maxLng; lng += georgiaStep) {
      if (pointInMultiPolygon([lng, lat], georgiaPolygons)) {
        // Get real 3D position on globe
        const realPos = latLngTo3D(lat, lng, globeRadius);
        
        // Scale outward from Georgia's 3D center (preserves shape on sphere)
        const offsetX = realPos.x - georgiaCenter3D.x;
        const offsetY = realPos.y - georgiaCenter3D.y;
        const offsetZ = realPos.z - georgiaCenter3D.z;
        
        const scaledX = georgiaCenter3D.x + offsetX * scaleFactor;
        const scaledY = georgiaCenter3D.y + offsetY * scaleFactor;
        const scaledZ = georgiaCenter3D.z + offsetZ * scaleFactor;
        
        // Normalize and elevate above surface
        const len = Math.sqrt(scaledX * scaledX + scaledY * scaledY + scaledZ * scaledZ);
        const elevatedRadius = globeRadius * 1.08;
        
        georgiaPositions.push(
          (scaledX / len) * elevatedRadius,
          (scaledY / len) * elevatedRadius,
          (scaledZ / len) * elevatedRadius
        );
        const variation = 0.9 + Math.random() * 0.1;
        georgiaColors.push(georgiaColor.r * variation, georgiaColor.g * variation, georgiaColor.b * variation);
        georgiaRndIds.push(Math.random());
      }
    }
  }
  
  return { worldPositions, worldColors, worldRndIds, georgiaPositions, georgiaColors, georgiaRndIds };
}

// Create arc between two points (optimized: reduced segments)
function createArc(
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: string,
  globeRadius: number
): { line: THREE.Line; material: THREE.LineBasicMaterial; points: THREE.Vector3[] } {
  const segments = 50; // Reduced from 100 for better performance
  const points: THREE.Vector3[] = new Array(segments + 1);
  const distance = start.distanceTo(end);
  const arcHeight = Math.min(globeRadius * 0.4, distance * 0.3);
  const piVal = Math.PI;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = new THREE.Vector3().lerpVectors(start, end, t);
    point.normalize().multiplyScalar(globeRadius + arcHeight * Math.sin(t * piVal));
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

// Shared geometries for better memory usage (created once, reused)
const sharedCoreGeometry = new THREE.SphereGeometry(0.006, 8, 8);
const sharedGlowGeometry = new THREE.SphereGeometry(0.012, 8, 8);
const sharedEndpointGeometry = new THREE.CircleGeometry(0.018, 16);
const originVector = new THREE.Vector3(0, 0, 0);

// Create traveling pulse with glow effect for arc animation (optimized)
function createTravelingPulse(color: string): THREE.Group {
  const group = new THREE.Group();
  
  // Inner bright core (uses shared geometry)
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
  });
  const core = new THREE.Mesh(sharedCoreGeometry, coreMaterial);
  group.add(core);
  
  // Outer glow (uses shared geometry)
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.6,
  });
  const glow = new THREE.Mesh(sharedGlowGeometry, glowMaterial);
  group.add(glow);
  
  return group;
}

// Create endpoint marker (optimized with shared geometry)
function createEndpoint(position: THREE.Vector3, color: string): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(sharedEndpointGeometry, material);
  mesh.position.copy(position);
  mesh.lookAt(originVector);
  return mesh;
}

export default function Globe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const frameIdRef = useRef<number>(0);
  const dotMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const georgiaMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const arcsRef = useRef<{ line: THREE.Line; material: THREE.LineBasicMaterial; points: THREE.Vector3[]; pulse: THREE.Group; pulseProgress: number; delay: number }[]>([]);
  const endpointsRef = useRef<{ mesh: THREE.Mesh; phase: number }[]>([]);
  
  const isDraggingRef = useRef(false);
  const previousMouseRef = useRef({ x: 0, y: 0 });
  // Georgia center position (lat ~42°, lng ~44°)
  // Y rotation: -(lng + 90) * PI/180 to bring that longitude to face camera
  // X rotation: tilt to show northern hemisphere
  const georgiaRotation = { x: 0.5, y: -2.34 };
  const targetRotationRef = useRef({ ...georgiaRotation });
  const autoRotateRef = useRef(false); // Start focused on Georgia, no auto-rotate
  const magnetToGeorgiaRef = useRef(true); // Magnet effect active
  const dragTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dragStartTimeRef = useRef<number>(0);
  
  // Normalize angle to [-PI, PI] range for shortest path interpolation
  const normalizeAngle = (angle: number): number => {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene - transparent background (page has dark bg)
    const scene = new THREE.Scene();
    scene.background = null;
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    const isMobile = width < height;
    camera.position.z = isMobile ? 4.0 : 2.6;
    cameraRef.current = camera;

    // Renderer (optimized settings)
    const renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio < 2, // Disable AA on high-DPI for performance
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.sortObjects = false; // Disable sorting for better performance
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Globe group
    const globeGroup = new THREE.Group();
    scene.add(globeGroup);
    globeGroupRef.current = globeGroup;

    const globeRadius = 1;

    // Load TopoJSON and create dots (using cached data)
    loadTopoData().then(({ landTopo, countriesTopo }) => {
      const landPolygons = topoJsonToPolygons(landTopo, 'land');
      const georgiaPolygons = getCountryPolygons(countriesTopo, GEORGIA_ISO);
      
      const { worldPositions, worldColors, worldRndIds, georgiaPositions, georgiaColors, georgiaRndIds } = 
        generateLandDots(landPolygons, georgiaPolygons, 8000, globeRadius);
      
      // World dots
      const worldGeometry = new THREE.BufferGeometry();
      worldGeometry.setAttribute('position', new THREE.Float32BufferAttribute(worldPositions, 3));
      worldGeometry.setAttribute('color', new THREE.Float32BufferAttribute(worldColors, 3));
      worldGeometry.setAttribute('rndId', new THREE.Float32BufferAttribute(worldRndIds, 1));
      
      const worldMaterial = new THREE.ShaderMaterial({
          uniforms: {
            u_time: { value: 0 },
            u_drag_time: { value: 0 },
            u_is_dragging: { value: 0 },
          },
          vertexShader: dotVertexShader,
          fragmentShader: dotFragmentShader,
          transparent: true,
      });
      
      const worldPoints = new THREE.Points(worldGeometry, worldMaterial);
      globeGroup.add(worldPoints);
      dotMaterialRef.current = worldMaterial;
      
      // Georgia dots
      if (georgiaPositions.length > 0) {
        const georgiaGeometry = new THREE.BufferGeometry();
        georgiaGeometry.setAttribute('position', new THREE.Float32BufferAttribute(georgiaPositions, 3));
        georgiaGeometry.setAttribute('color', new THREE.Float32BufferAttribute(georgiaColors, 3));
        georgiaGeometry.setAttribute('rndId', new THREE.Float32BufferAttribute(georgiaRndIds, 1));
        
        const georgiaMaterial = new THREE.ShaderMaterial({
          uniforms: { u_time: { value: 0 } },
          vertexShader: georgiaVertexShader,
          fragmentShader: georgiaFragmentShader,
          transparent: true,
        });
        
        const georgiaPoints = new THREE.Points(georgiaGeometry, georgiaMaterial);
        globeGroup.add(georgiaPoints);
        georgiaMaterialRef.current = georgiaMaterial;
      }
      
      // Create arcs, traveling pulses, and endpoints
      connections.forEach((conn, index) => {
        const startPos = latLngTo3D(conn.start.lat, conn.start.lng, globeRadius);
        const endPos = latLngTo3D(conn.end.lat, conn.end.lng, globeRadius);
        
        const { line, material, points } = createArc(startPos, endPos, conn.color, globeRadius);
        globeGroup.add(line);
        
        // Create traveling pulse
        const pulse = createTravelingPulse(conn.color);
        globeGroup.add(pulse);
        
        arcsRef.current.push({ 
          line, 
          material, 
          points,
          pulse,
          pulseProgress: Math.random(), // Start at random position
          delay: index * 0.15 
        });
        
        // Only add endpoint at destination (not at Georgia start)
        const endEndpoint = createEndpoint(endPos, conn.color);
        globeGroup.add(endEndpoint);
        
        endpointsRef.current.push(
          { mesh: endEndpoint, phase: Math.random() * Math.PI * 2 }
        );
      });
    }).catch(err => console.error('Failed to load TopoJSON:', err));

    // Initial rotation - center on Georgia
    targetRotationRef.current.x = georgiaRotation.x;
    targetRotationRef.current.y = georgiaRotation.y;
    globeGroup.rotation.x = georgiaRotation.x;
    globeGroup.rotation.y = georgiaRotation.y;

    // Mouse handlers
    const handleMouseDown = (event: MouseEvent) => {
      isDraggingRef.current = true;
      previousMouseRef.current = { x: event.clientX, y: event.clientY };
      magnetToGeorgiaRef.current = false; // Disable magnet while dragging
      dragStartTimeRef.current = performance.now();
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current || !globeGroupRef.current) return;
      const deltaX = event.clientX - previousMouseRef.current.x;
      const deltaY = event.clientY - previousMouseRef.current.y;
      targetRotationRef.current.y += deltaX * 0.005;
      targetRotationRef.current.x += deltaY * 0.005;
      previousMouseRef.current = { x: event.clientX, y: event.clientY };
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      // After 1.5 seconds, activate magnet to Georgia
      dragTimeoutRef.current = setTimeout(() => { 
        magnetToGeorgiaRef.current = true;
      }, 1500);
    };
    
    // Touch handlers
    const handleTouchStart = (event: TouchEvent) => {
      event.preventDefault();
      if (event.touches.length === 1) {
        isDraggingRef.current = true;
        previousMouseRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        magnetToGeorgiaRef.current = false; // Disable magnet while dragging
        dragStartTimeRef.current = performance.now();
        if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      if (event.touches.length === 1 && isDraggingRef.current && globeGroupRef.current) {
        const deltaX = event.touches[0].clientX - previousMouseRef.current.x;
        const deltaY = event.touches[0].clientY - previousMouseRef.current.y;
        targetRotationRef.current.y += deltaX * 0.005;
        targetRotationRef.current.x += deltaY * 0.005;
        previousMouseRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }
    };

    const handleTouchEnd = () => {
      isDraggingRef.current = false;
      // After 1.5 seconds, activate magnet to Georgia
      dragTimeoutRef.current = setTimeout(() => { 
        magnetToGeorgiaRef.current = true;
      }, 1500);
    };

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mouseleave', handleMouseUp);
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);

    // Animation loop (optimized with actual timestamps)
    let time = 0;
    let lastTime = performance.now();
    
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      time += delta;

      if (globeGroupRef.current) {
        // Magnet effect - smoothly return to Georgia
        if (magnetToGeorgiaRef.current && !isDraggingRef.current) {
          // Normalize current rotation to find shortest path
          const currentY = normalizeAngle(targetRotationRef.current.y);
          const targetY = georgiaRotation.y;
          
          // Calculate shortest path difference
          let diffY = targetY - currentY;
          if (diffY > Math.PI) diffY -= 2 * Math.PI;
          if (diffY < -Math.PI) diffY += 2 * Math.PI;
          
          // Smoothly interpolate towards Georgia (3x faster)
          targetRotationRef.current.x += (georgiaRotation.x - targetRotationRef.current.x) * 0.09;
          targetRotationRef.current.y += diffY * 0.09;
          
          // Once close enough, snap and stop
          const distX = Math.abs(targetRotationRef.current.x - georgiaRotation.x);
          const distY = Math.abs(diffY);
          if (distX < 0.01 && distY < 0.01) {
            targetRotationRef.current.x = georgiaRotation.x;
            targetRotationRef.current.y = georgiaRotation.y;
          }
        }
        
        globeGroupRef.current.rotation.x += (targetRotationRef.current.x - globeGroupRef.current.rotation.x) * 0.08;
        globeGroupRef.current.rotation.y += (targetRotationRef.current.y - globeGroupRef.current.rotation.y) * 0.08;
      }

      // Update dot shader uniforms
      if (dotMaterialRef.current) {
        dotMaterialRef.current.uniforms.u_time.value = time;
        if (isDraggingRef.current) {
          const dragDuration = performance.now() - dragStartTimeRef.current;
          dotMaterialRef.current.uniforms.u_drag_time.value = dragDuration;
          dotMaterialRef.current.uniforms.u_is_dragging.value = 1.0;
        } else {
          const currentDragTime = dotMaterialRef.current.uniforms.u_drag_time.value;
          dotMaterialRef.current.uniforms.u_drag_time.value = Math.max(0, currentDragTime - 30);
          if (currentDragTime <= 0) {
            dotMaterialRef.current.uniforms.u_is_dragging.value = 0.0;
          }
        }
      }

      if (georgiaMaterialRef.current) {
        georgiaMaterialRef.current.uniforms.u_time.value = time;
      }
      
      // Animate arcs and traveling pulses (optimized with cached values)
      const arcs = arcsRef.current;
      const arcsLen = arcs.length;
      const scalePulse = 0.8 + Math.sin(time * 0.01) * 0.2;
      
      for (let i = 0; i < arcsLen; i++) {
        const arc = arcs[i];
        
        // Update pulse progress
        arc.pulseProgress += 0.006;
        if (arc.pulseProgress > 1.2) arc.pulseProgress = -arc.delay * 0.5;
        
        // Animate traveling pulse position along the arc
        const progress = arc.pulseProgress;
        if (progress > 0 && progress < 1) {
          const pointIndex = (progress * (arc.points.length - 1)) | 0; // Fast floor
          arc.pulse.position.copy(arc.points[pointIndex]);
          arc.pulse.visible = true;
          arc.pulse.scale.setScalar(scalePulse);
        } else {
          arc.pulse.visible = false;
        }
      }

      // Pulse endpoints (optimized)
      const endpoints = endpointsRef.current;
      const endpointsLen = endpoints.length;
      const timeScaled = time * 0.003;
      
      for (let i = 0; i < endpointsLen; i++) {
        const ep = endpoints[i];
        ep.mesh.scale.setScalar(1 + Math.sin(timeScaled + ep.phase) * 0.2);
      }

      renderer.render(scene, camera);
    };

    animate();

    // Resize handler
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;
      const isMobileView = newWidth < newHeight;
      cameraRef.current.position.z = isMobileView ? 4.0 : 2.6;
      cameraRef.current.aspect = newWidth / newHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(newWidth, newHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mouseleave', handleMouseUp);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      cancelAnimationFrame(frameIdRef.current);
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
      if (rendererRef.current && container.contains(rendererRef.current.domElement)) {
        container.removeChild(rendererRef.current.domElement);
      }
      rendererRef.current?.dispose();
    };
  }, []);

  return (
      <div
        ref={containerRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        style={{ minHeight: '500px' }}
      />
  );
}
